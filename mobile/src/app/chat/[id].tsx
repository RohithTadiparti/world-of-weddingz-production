import { useEffect, useRef, useState } from "react";
import {
  Alert as NativeAlert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { WowHeaderLogo } from "@/components/common/wow-header";
import {
  ArrowLeft,
  DotsThreeVertical,
  Paperclip,
  PaperPlaneRight,
} from "phosphor-react-native";

import { Sheet } from "@/components/sheet";
import { documentName, reachable, PhotoPicker } from "@/components/uploader";
import { Alert, Body, Button, Caption, Loading } from "@/components/ui";
import { api, apiMessage } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { isChartImage } from "@/shared/horoscope";
import { radius, rgb, space, useTheme } from "@/theme";

interface Message {
  id: string;
  senderId: string;
  body: string;
  mediaUrl: string | null;
  readAt: string | null;
  createdAt: string;
}
export default function Thread() {
  const theme = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const list = useRef<FlatList<Message>>(null);
  const marked = useRef(false);
  const {
    id,
    name = "Conversation",
    photo,
    online,
  } = useLocalSearchParams<{
    id: string;
    name?: string;
    photo?: string;
    online?: string;
  }>();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [mutedHere, setIsMuted] = useState<boolean | null>(null);
  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: async () =>
      (await api.get("/chat/conversations")).data as { withUserId: string; muted?: boolean }[],
    retry: false,
  });
  const isMuted =
    mutedHere ?? Boolean(conversations.data?.find((c) => c.withUserId === id)?.muted);
  const history = useQuery({
    queryKey: ["chat-history", id],
    queryFn: async () =>
      (
        await api.get("/chat/messages", {
          params: { withUserId: id, page: 1, limit: 50 },
        })
      ).data as { data: Message[] },
    enabled: Boolean(id),
    retry: false,
    refetchInterval: 5_000,
  });
  const read = useMutation({
    mutationFn: () =>
      api.put("/chat/messages/read", {}, { params: { withUserId: id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["unread-count"] });
    },
  });
  useEffect(() => {
    if (id && !history.isPending && !marked.current) {
      marked.current = true;
      read.mutate();
    }
  }, [id, history.isPending, read]);
  const send = useMutation({
    mutationFn: ({ body, mediaUrl }: { body: string; mediaUrl?: string }) =>
      api.post("/chat/messages", { toUserId: id, body, mediaUrl }),
    onSuccess: () => {
      setDraft("");
      setError("");
      void qc.invalidateQueries({ queryKey: ["chat-history", id] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e) => setError(apiMessage(e, "That message could not be sent.")),
  });
  const mute = useMutation({
    mutationFn: () => api.put("/chat/mute", { withUserId: id, muted: !isMuted }),
    onSuccess: () => {
      setIsMuted(!isMuted);
      setMore(false);
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e) => setError(apiMessage(e, "Conversation could not be muted.")),
  });
  const clear = useMutation({
    mutationFn: () => api.put("/chat/clear", { withUserId: id }),
    onSuccess: () => {
      setMore(false);
      void qc.invalidateQueries({ queryKey: ["chat-history", id] });
    },
    onError: (e) =>
      setError(apiMessage(e, "Conversation could not be cleared.")),
  });
  const confirmClear = () => {
    if (Platform.OS === 'web') {
      if (window.confirm("Clear this conversation?")) {
        clear.mutate();
      }
      return;
    }
    NativeAlert.alert("Clear this conversation?", "", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => clear.mutate(),
      },
    ]);
  };
  if (history.isPending)
    return (
      <View
        style={{
          flex: 1,
          padding: space(4),
          backgroundColor: rgb(theme.canvas),
        }}
      >
        <Loading rows={5} />
      </View>
    );
  const messages = history.data?.data ?? [];
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: rgb(theme.canvas) }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Header
        name={name}
        photo={photo}
        online={online === "true"}
        onBack={() => router.back()}
        onMore={() => setMore(true)}
      />
      <FlatList
        ref={list}
        inverted
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: space(4), gap: space(2) }}
        ListEmptyComponent={
          <Caption tone="faint" style={{ textAlign: "center" }}>
            No messages yet. Say hello.
          </Caption>
        }
        renderItem={({ item }) => (
          <Bubble message={item} mine={item.senderId !== id} />
        )}
      />
      {history.error ? (
        <View style={{ paddingHorizontal: space(3) }}>
          <Alert tone="critical">{apiMessage(history.error, "Could not load messages.")}</Alert>
        </View>
      ) : null}
      {error ? (
        <View style={{ paddingHorizontal: space(3) }}>
          <Alert tone="critical">{error}</Alert>
        </View>
      ) : null}
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={() => send.mutate({ body: draft.trim() })}
        busy={send.isPending}
        onAttachment={() => setAttachmentOpen(true)}
      />
      <Sheet visible={more} title="Conversation" onClose={() => setMore(false)}>
        <Button
          label={isMuted ? "Unmute conversation" : "Mute conversation"}
          variant="outline"
          onPress={() => mute.mutate()}
          busy={mute.isPending}
        />
        <Button
          label="Clear messages"
          variant="outline"
          onPress={confirmClear}
          busy={clear.isPending}
        />
      </Sheet>
      <Sheet
        visible={attachmentOpen}
        title="Send Attachment"
        onClose={() => setAttachmentOpen(false)}
      >
        <PhotoPicker
          kind="attachment"
          onUploaded={(url) => {
            setAttachmentOpen(false);
            send.mutate({ body: draft.trim(), mediaUrl: url });
          }}
        />
      </Sheet>
    </KeyboardAvoidingView>
  );
}
function Header({
  name,
  photo,
  online,
  onBack,
  onMore,
}: {
  name: string;
  photo?: string;
  online: boolean;
  onBack: () => void;
  onMore: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: space(3),
        paddingTop: space(5),
        paddingBottom: space(2),
        flexDirection: "row",
        alignItems: "center",
        gap: space(2),
        borderBottomWidth: 1,
        borderColor: rgb(theme.border),
        backgroundColor: rgb(theme.surface),
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
      >
        <ArrowLeft size={22} color={rgb(theme.ink[800])} />
      </Pressable>
      {photo ? (
        <Image
          source={{ uri: photo }}
          style={{ width: 42, height: 42, borderRadius: radius.md }}
        />
      ) : (
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: radius.md,
            backgroundColor: rgb(theme.surfaceSunken),
          }}
        />
      )}
      <View style={{ flex: 1 }}>
        <Caption
          numberOfLines={1}
          style={{
            fontSize: 16,
            fontWeight: "700",
            color: rgb(theme.ink[900]),
          }}
        >
          {name}
        </Caption>
        <View
          style={{ flexDirection: "row", gap: space(1), alignItems: "center" }}
        >
          {online ? (
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: radius.md,
                backgroundColor: rgb(theme.positiveFg),
              }}
            />
          ) : null}
          <Caption tone="faint">{online ? "Online" : "Offline"}</Caption>
        </View>
      </View>
      <WowHeaderLogo />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="More options"
        onPress={onMore}
      >
        <DotsThreeVertical
          size={22}
          color={rgb(theme.ink[700])}
          weight="bold"
        />
      </Pressable>
    </View>
  );
}
function Composer({
  value,
  onChange,
  onSend,
  busy,
  onAttachment,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  busy: boolean;
  onAttachment: () => void;
}) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space(2),
        padding: space(3),
        borderTopWidth: 1,
        borderColor: rgb(theme.border),
        backgroundColor: rgb(theme.surface),
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Attach file"
        onPress={onAttachment}
      >
        <Paperclip size={23} color={rgb(theme.ink[500])} />
      </Pressable>
      <View
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          borderRadius: radius.md,
          backgroundColor: rgb(theme.surfaceSunken),
        }}
      >
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChange}
          placeholder="Type a message..."
          placeholderTextColor={rgb(theme.ink[400])}
          style={{
            flex: 1,
            minHeight: 46,
            maxHeight: 110,
            paddingHorizontal: space(3),
            color: rgb(theme.ink[900]),
            fontSize: 16,
          }}
          multiline
          maxLength={4000}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send"
        disabled={!value.trim() || busy}
        onPress={onSend}
        style={{
          width: 46,
          height: 46,
          borderRadius: radius.md,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: rgb(
            value.trim() ? theme.brand : theme.surfaceSunken,
          ),
        }}
      >
        <PaperPlaneRight
          size={20}
          weight="fill"
          color={rgb(value.trim() ? theme.brandFg : theme.ink[400])}
        />
      </Pressable>
    </View>
  );
}
function Bubble({ message, mine }: { message: Message; mine: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: mine ? "flex-end" : "flex-start" }}>
      <View
        style={{
          maxWidth: "82%",
          borderRadius: radius.md,
          paddingHorizontal: space(3),
          paddingVertical: space(2),
          backgroundColor: rgb(mine ? theme.brandSoft : theme.surface),
        }}
      >
        {message.mediaUrl ? <Attachment url={message.mediaUrl} /> : null}
        {message.body ? <Body>{message.body}</Body> : null}
      </View>
      <Caption tone="faint" style={{ marginTop: 2 }}>
        {dateTime(message.createdAt)}
        {mine ? (message.readAt ? " · read" : " · sent") : ""}
      </Caption>
    </View>
  );
}
function Attachment({ url }: { url: string }) {
  const theme = useTheme();
  const uri = reachable(url);
  return isChartImage(url) ? (
    <Pressable onPress={() => void Linking.openURL(uri)}>
      <Image
        source={{ uri }}
        style={{ width: 190, height: 190, borderRadius: radius.md }}
      />
    </Pressable>
  ) : (
    <Pressable
      onPress={() => void Linking.openURL(uri)}
      style={{ flexDirection: "row", gap: space(1), alignItems: "center" }}
    >
      <Paperclip size={16} color={rgb(theme.ink[600])} />
      <Caption numberOfLines={1} style={{ maxWidth: 180 }}>
        {documentName(url)}
      </Caption>
    </Pressable>
  );
}
