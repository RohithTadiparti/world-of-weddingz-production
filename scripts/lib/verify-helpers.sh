#!/bin/sh
# Fixtures shared by the live suites: real uploads, a complete biodata, and a
# persona that is ready to send and answer interests.
#
# Sourced after `req` and lib-identity.sh, never run on its own. Uses the same
# $API and /tmp/body conventions as every suite. Uploads send no cookies: the
# bearer token is the whole of the auth, and not every suite keeps a jar.
#
# Why these exist:
#  - Fields holding an uploaded file accept only what the platform's own
#    storage handed out (a media:// reference, the CDN base, the local store's
#    path). A literal https://cdn.example.com/... is refused, so a suite has to
#    upload the way the web client does: presign, PUT the bytes, confirm.
#  - Sending an interest needs the sender's biodata complete (all sections,
#    three photographs) and their identity verified, and the target's biodata
#    complete as well. A target that is not ready is answered like a private
#    profile.

# The presign builds its URLs from the origin the request reached. Inside the
# compose network that is http://backend:3000, which is not an origin the
# store recognises as its own, so a suite says it came in through a local
# proxy, which is what the web client's nginx does. Set it empty to send no
# header (a deployment with a CDN or a real APP_BASE_URL does not need it).
MEDIA_FORWARDED_HOST=${MEDIA_FORWARDED_HOST-localhost}

VERIFY_PHOTO=/tmp/verify-photo.png
VERIFY_PDF=/tmp/verify-document.pdf

# A real 1x1 PNG, and a PDF with a real header. Nothing reads the pixels, but
# a store that sniffs content should see what the name claims.
if [ ! -s "$VERIFY_PHOTO" ]; then
  printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' \
    | base64 -d > "$VERIFY_PHOTO"
fi
if [ ! -s "$VERIFY_PDF" ]; then
  printf '%%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%%%EOF\n' > "$VERIFY_PDF"
fi

# A fresh Indian mobile number every call, for accounts the suites create
# outside their own `reg` (verification officers must have one). Random rather
# than counted, for the same subshell reason as next_aadhaar.
fixture_phone() {
  fp_digits=$(head -c 64 /proc/sys/kernel/random/uuid | tr -dc '0-9')
  while [ ${#fp_digits} -lt 9 ]; do
    fp_digits="$fp_digits$(head -c 64 /proc/sys/kernel/random/uuid | tr -dc '0-9')"
  done
  printf '9%.9s' "$fp_digits"
}

# upload_media <token> <filename> [presign route] [extra presign fields]
#   -> echoes the URL to store.
#
# The route decides where the file is filed and what it may be:
# /media/profile-photo/presign (the default) for photographs,
# /media/attachment/presign for evidence, an image or a PDF. Extra fields are
# appended to the presign body as written, e.g. ',"purpose":"portfolio"'. The
# file name is kept in the stored key, which is what the generated-image check
# reads, so a suite can still upload "midjourney-portrait.png" to exercise
# that refusal.
upload_media() {
  um_token=$1
  um_name=$2
  um_route=${3:-/media/profile-photo/presign}
  um_extra=${4:-}
  case "$um_name" in
    *.pdf) um_file=$VERIFY_PDF; um_type=application/pdf ;;
    *.png) um_file=$VERIFY_PHOTO; um_type=image/png ;;
    *.webp) um_file=$VERIFY_PHOTO; um_type=image/webp ;;
    *) um_file=$VERIFY_PHOTO; um_type=image/jpeg ;;
  esac
  um_size=$(wc -c < "$um_file" | tr -d ' ')

  set -- -s -o /tmp/body -w '%{http_code}' -X POST "$API$um_route" \
    -H 'Content-Type: application/json' -H "Authorization: Bearer $um_token" \
    -d "{\"filename\":\"$um_name\",\"size\":$um_size,\"contentType\":\"$um_type\"$um_extra}"
  [ -n "$MEDIA_FORWARDED_HOST" ] && set -- "$@" -H "X-Forwarded-Host: $MEDIA_FORWARDED_HOST"
  um_code=$(curl "$@")
  um_upload=$(jq -r '.uploadUrl // empty' /tmp/body 2>/dev/null)
  um_public=$(jq -r '.publicUrl // empty' /tmp/body 2>/dev/null)
  um_key=$(jq -r '.key // empty' /tmp/body 2>/dev/null)
  if [ -z "$um_upload" ] || [ -z "$um_public" ]; then
    printf '  (fixture) presign for %s failed: HTTP %s %s\n' "$um_name" "$um_code" "$(head -c 160 /tmp/body)" >&2
    return 1
  fi

  # The local store's PUT is reached through the API this suite already talks
  # to; the forwarded host above only shapes the URL that gets stored. Any
  # other store (S3) is PUT to exactly where presign said.
  case "$um_upload" in
    */mock-storage/*) um_target="$API/mock-storage/${um_upload#*/mock-storage/}" ;;
    *) um_target=$um_upload ;;
  esac
  set -- -s -o /tmp/put-body -w '%{http_code}' -X PUT "$um_target" \
    -H "Content-Type: $um_type" --data-binary "@$um_file"
  while IFS= read -r um_header; do
    [ -n "$um_header" ] && set -- "$@" -H "$um_header"
  done <<EOF
$(jq -r '.headers // {} | to_entries[] | select(.key | ascii_downcase != "content-type") | "\(.key): \(.value)"' /tmp/body 2>/dev/null)
EOF
  um_code=$(curl "$@")
  case "$um_code" in
    2*) ;;
    *)
      printf '  (fixture) storage refused %s: HTTP %s %s\n' "$um_name" "$um_code" "$(head -c 160 /tmp/put-body)" >&2
      return 1
      ;;
  esac

  # Confirmed the way the web client confirms it: the server checks what
  # landed before anything is attached to it.
  um_code=$(req POST /media/complete "{\"key\":\"$um_key\"}" "$um_token")
  case "$um_code" in
    2*) ;;
    *)
      printf '  (fixture) could not confirm %s: HTTP %s %s\n' "$um_name" "$um_code" "$(head -c 160 /tmp/body)" >&2
      return 1
      ;;
  esac
  printf '%s' "$um_public"
}

# seed_photos <profileId> <token> -> tops the profile up to three photographs.
#
# Three before the details: the section that starts the biodata will not save
# without them. Counted first so a suite calling it twice stays under the cap.
seed_photos() {
  sp_profile=$1
  sp_token=$2
  req GET "/profiles/$sp_profile/details/photos" "" "$sp_token" >/dev/null
  sp_have=$(jq -r '(.photos // []) | length' /tmp/body 2>/dev/null)
  sp_have=${sp_have:-0}
  while [ "$sp_have" -lt 3 ]; do
    sp_have=$((sp_have + 1))
    sp_url=$(upload_media "$sp_token" "seed-$sp_have.jpg") || return 1
    sp_code=$(req POST "/profiles/$sp_profile/details/photos" "{\"url\":\"$sp_url\"}" "$sp_token")
    if [ "$sp_code" != "200" ] && [ "$sp_code" != "201" ]; then
      printf '  (fixture) could not add a photo to %s: HTTP %s %s\n' \
        "$sp_profile" "$sp_code" "$(head -c 160 /tmp/body)" >&2
      return 1
    fi
  done
}

# complete_biodata <profileId> <token> [first name] [last name]
#
# Every section the completion report asks for, identity aside. The profile's
# gender and date of birth must already be set (PUT /users/me/profile, or the
# managed profile's own record).
#
# A family net worth is always sent: the server keeps it for a groom, where it
# is required, and drops it for a bride with a notice, which is the documented
# behaviour rather than an error.
complete_biodata() {
  cb_profile=$1
  cb_token=$2
  cb_first=${3:-Test}
  cb_last=${4:-Person}
  seed_photos "$cb_profile" "$cb_token" || return 1
  req PUT "/profiles/$cb_profile/details/personal" \
    "{\"firstName\":\"$cb_first\",\"lastName\":\"$cb_last\",\"heightCm\":168,\"complexion\":\"fair\",\"communicationAddress\":\"12 Jubilee Hills, Hyderabad\"}" \
    "$cb_token" >/dev/null
  req PUT "/profiles/$cb_profile/details/religion" \
    '{"religion":"Hindu","caste":"Kamma","subCaste":"None","motherTongue":"Telugu"}' "$cb_token" >/dev/null
  req PUT "/profiles/$cb_profile/details/horoscope" '{"horoscopeAvailable":false}' "$cb_token" >/dev/null
  req PUT "/profiles/$cb_profile/details/marital" '{"maritalStatus":"never_married"}' "$cb_token" >/dev/null
  req PUT "/profiles/$cb_profile/details/family" \
    '{"father":{"name":"Ramesh Rao","profession":"Retired"},"mother":{"name":"Lakshmi Rao"},"familyType":"nuclear","familyStatus":"middle_class","brothers":1,"sisters":0,"familyNetWorth":5000000}' \
    "$cb_token" >/dev/null
  req PUT "/profiles/$cb_profile/details/education" \
    '{"highestQualification":"M.Tech","course":"Computer Science","occupationStatus":"employed","employment":{"company":"Infosys","designation":"Engineer"}}' \
    "$cb_token" >/dev/null
  req PUT "/profiles/$cb_profile/details/preferences" \
    '{"preferredAgeMin":22,"preferredAgeMax":40,"preferredHeightMinCm":150,"preferredHeightMaxCm":195}' \
    "$cb_token" >/dev/null

  req GET "/profiles/$cb_profile/details/completion" "" "$cb_token" >/dev/null
  cb_missing=$(jq -r '[(.missing // [])[] | select(. != "identity")] | join(", ")' /tmp/body 2>/dev/null)
  if [ -n "$cb_missing" ]; then
    printf '  (fixture) biodata for %s still missing: %s\n' "$cb_profile" "$cb_missing" >&2
    return 1
  fi
}

# agency_matchable <profileId> <agentToken>
#
# An agency's new client starts private, so its details can be reviewed before
# anyone sees it; the agent then makes it matchable on purpose. A private
# profile is refused as an interest target, so a suite that introduces agency
# clients has to take that step too.
agency_matchable() {
  am_code=$(req PUT "/agents/profiles/$1" '{"visibility":"matches_only"}' "$2")
  if [ "$am_code" != "200" ]; then
    printf '  (fixture) could not make %s matchable: HTTP %s %s\n' "$1" "$am_code" "$(head -c 160 /tmp/body)" >&2
    return 1
  fi
}

# ready_for_interests <profileId> <token> [first name] [last name]
#
# A complete biodata plus a verified identity: what sending, accepting and
# fixing a match all require. Identity is only verified once per profile.
ready_for_interests() {
  rf_profile=$1
  rf_token=$2
  complete_biodata "$rf_profile" "$rf_token" "$3" "$4" || return 1
  req GET "/profiles/$rf_profile/identity/aadhaar" "" "$rf_token" >/dev/null
  if [ -z "$(jq -r '.verifiedAt // empty' /tmp/body 2>/dev/null)" ]; then
    verify_identity "$rf_profile" "$rf_token" >/dev/null || return 1
  fi
}

# A business now has a life rather than a boolean, so getting one live means
# walking the path a vendor actually walks: fill in the catalog, look it over,
# submit, then allocate, visit and decide. Skipping to "approved" is refused,
# which is the point of the state machine.
#
#   go_live <businessToken> <businessId> <adminToken> <officerId> <officerToken>
FINDINGS_JSON='{"visited":true,"observations":"Attended the address; the business is as described.","issues":[],"recommendation":"approve"}'

# The catalog is configuration, so a service asks whatever an administrator
# decided it should ask. The helper therefore reads the form and answers it,
# rather than assuming a shape — which is the same reason the form exists.
answers_for() { # answers_for <serviceForm json on stdin>
  jq -c '[.[] | select(.required)] | map({(.key): (
      if   .type == "boolean"       then true
      elif .type == "single_select" then (.constraints.options[0].value // "other")
      elif .type == "multi_select"  then [(.constraints.options[0].value // "other")]
      elif .type == "date"          then "2027-01-01"
      elif .type == "time"          then "10:00"
      elif .type == "date_time"     then "2027-01-01T10:00:00.000Z"
      elif .type == "url"           then "https://example.com/portfolio"
      elif (.type == "number" or .type == "decimal" or .type == "currency"
            or .type == "duration" or .type == "range")
                                    then (.constraints.min // 1)
      else "Not specified" end)}) | add // {}'
}

seed_catalog() { # seed_catalog <token> <businessId>
  req GET /catalog/categories "" "$1" >/dev/null
  cat_ids=$(jq -r '.[].id' /tmp/body)
  # An empty catalog is a setup problem, not a test failure, and it used to
  # look like one six assertions later: this returned quietly, the business got
  # no priced service, and the suite reported "Finish these first: Catalog
  # services" from somewhere else entirely. Say it here, where it is true.
  if [ -z "$cat_ids" ]; then
    echo "  FAIL  the service catalog is empty — run the catalog seed first:" >&2
    echo "        docker compose -f docker/docker-compose.yml --profile seed run --rm seed-catalog" >&2
    FAIL=$((FAIL + 1))
    return 1
  fi

  for cat_id in $cat_ids; do
    req GET "/catalog/categories/$cat_id/services" "" "$1" >/dev/null
    def_ids=$(jq -r '.[].id' /tmp/body)
    for def_id in $def_ids; do
      req GET "/catalog/services/$def_id" "" "$1" >/dev/null
      def_json=$(cat /tmp/body)
      attrs=$(echo "$def_json" | jq -c '.serviceForm' | answers_for)
      req POST "/vendors/$2/services" "{\"definitionId\":\"$def_id\",\"attributes\":$attrs}" "$1" >/dev/null
      svc_id=$(jq -r '.id // empty' /tmp/body)
      [ -z "$svc_id" ] && continue

      # The definition decides which pricing models a service may use, so the
      # price is built from that rather than assumed. Quote-only models carry
      # no amount; everything else does.
      model=$(echo "$def_json" | jq -r '.definition.allowedPricingModels[0] // "fixed"')
      case "$model" in
        custom_quote|no_public_price) price_json="" ;;
        *) price_json=',"price":"25000"' ;;
      esac
      req POST "/vendors/$2/services/$svc_id/offerings" \
        "{\"name\":\"Standard\",\"pricingModel\":\"$model\"$price_json,\"active\":true}" "$1" >/dev/null
      [ "$(jq -r '.id // empty' /tmp/body)" != "" ] && return 0
    done
  done
  return 1
}

# business_documents <vendorToken> <businessId>
#
# What a listing needs besides its catalog before it can be reviewed: a
# contact mobile, at least one compliance document and at least one portfolio
# photograph. Both files are uploaded for real, since those fields only take
# what the platform's own storage handed out.
business_documents() {
  bd_doc=$(upload_media "$1" "registration-certificate.pdf" /media/attachment/presign) || return 1
  bd_photo=$(upload_media "$1" "portfolio-hall.jpg" /media/profile-photo/presign ',"purpose":"portfolio"') || return 1
  bd_code=$(req PUT "/vendors/$2" \
    "{\"contactPhone\":\"$(fixture_phone)\",\"complianceDocuments\":[\"$bd_doc\"],\"portfolio\":[\"$bd_photo\"]}" "$1")
  if [ "$bd_code" != "200" ]; then
    printf '  (fixture) could not add documents to %s: HTTP %s %s\n' "$2" "$bd_code" "$(head -c 160 /tmp/body)" >&2
    return 1
  fi
}

go_live() { # go_live <vendorToken> <businessId> <adminToken> <officerId> <officerToken>
  seed_catalog "$1" "$2" || return 1
  business_documents "$1" "$2" || return 1
  req POST "/vendors/$2/first-review" "" "$1" >/dev/null
  req POST "/vendors/$2/submit-verification" "" "$1" >/dev/null

  req GET "/verification/requests?applicantType=vendor&limit=100" "" "$3" >/dev/null
  vreq=$(jq -r --arg id "$2" '(.data // .)[] | select(.subjectId == $id) | .id' /tmp/body | head -1)
  [ -z "$vreq" ] && return 1

  req PUT "/verification/requests/$vreq/allocate" "{\"officerUserId\":\"$4\"}" "$3" >/dev/null
  req PUT "/verification/requests/$vreq/start" "" "$5" >/dev/null
  req PUT "/verification/requests/$vreq/findings" "$FINDINGS_JSON" "$5" >/dev/null
  # The officer recommends; only an administrator decides (ISS-20).
  req PUT "/verification/requests/$vreq/decide" '{"status":"approved"}' "$3" >/dev/null
  return 0
}
