# Biodata Feature Verification

## Height contract

The API and database use integer centimeters (`heightCm`, `preferredHeightMinCm`, and `preferredHeightMaxCm`). Forms may accept feet and inches, but convert to centimeters before sending. Displayed values convert back to feet and inches. Inches must be between 0 and 11.

The height conversion tests cover 5 ft 6 in, 5 ft 7 in, 5 ft 10 in, 5 ft 11 in, round trips, and invalid inches. The forward migration repairs databases that already have the PR's decimal-feet columns; it does not convert centimeter data to feet.

## Test execution

Backend E2E tests require the PostgreSQL and Redis test services described in [DOCKER-AND-TESTING.md](DOCKER-AND-TESTING.md). Jest creates a unique writable temporary directory for mock media storage and removes it after each E2E file. Normal application configuration continues to use `MEDIA_MOCK_DIR` or its `/app/media-store` default.

Run checks from `backend/`:

```text
npm run typecheck
npm test -- --runInBand src/modules/profile-details/height-validation.spec.ts src/modules/bookings/bookings.service.spec.ts src/modules/matchmaking/compatibility.engine.spec.ts
npm run test:e2e
```

## Open product decision

Family net worth remains optional for every profile. Existing clients can omit it, the DTO accepts omission, and the database column is nullable. No existing contract or test establishes a groom-only requirement. Product should decide whether to collect this field and under what privacy policy before any validation requirement is introduced.