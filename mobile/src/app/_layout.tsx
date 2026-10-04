import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { bootstrapSession } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { rgb, useHydrateTheme, useTheme } from '@/theme';
import { FONT_ASSETS, typeface } from '@/theme/fonts';
import { KeyboardAwareApp } from '@/components/keyboard-aware-app';
import { WowHeaderLogo } from '@/components/common/wow-header';

void SplashScreen.preventAutoHideAsync();

/**
 * One retry, and never on a 401.
 *
 * The interceptor already refreshes and replays a request whose token expired,
 * so a 401 that reaches here is a real answer: the account is signed out. Query
 * retrying it three more times only delays the login screen.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failures, error) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403) return false;
        return failures < 1;
      },
      staleTime: 30_000,
    },
  },
});

/**
 * Sends a signed-out person to the login screen and a signed-in one away from
 * it.
 *
 * Held until `ready`, which the boot-time refresh sets. Redirecting before then
 * would bounce everybody with a perfectly good stored session to login for the
 * half-second the keystore read takes.
 */
function useAuthGate() {
  const user = useAuth((s) => s.user);
  const ready = useAuth((s) => s.ready);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    // Both ends of the signed-out flow, or opening sign-up would bounce
    // straight back to sign-in — which is the screen it was reached from.
    const inAuthFlow = segments[0] === 'login' || segments[0] === 'register';
    // A guest answering their invitation has no account; the link is their key.
    const isPublic = (segments[0] as string) === 'rsvp';
    if (!user && !inAuthFlow && !isPublic) router.replace('/login');
    else if (user && inAuthFlow) router.replace('/');
  }, [ready, user, segments, router]);
}

/**
 * Wipe the query cache whenever the signed-in user changes (EZ1-I122).
 *
 * The same data-isolation rule the web app enforces: signing out and back in as
 * somebody else never restarts the app, and with a 30s staleTime the previous
 * user's cached answers would otherwise be served to the next one. Clearing on
 * any change away from a real user makes one account's data unable to appear
 * under another's session.
 */
function useClearCacheOnUserChange() {
  const userId = useAuth((s) => s.user?.id ?? null);
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (prev.current != null && prev.current !== userId) {
      queryClient.clear();
    }
    prev.current = userId;
  }, [userId]);
}

export default function RootLayout() {
  const theme = useTheme();
  const themeReady = useHydrateTheme();
  const authReady = useAuth((s) => s.ready);
  const [booted, setBooted] = useState(false);
  // A font that fails to load falls back to the system face rather than
  // holding the app on its splash screen.
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);

  useEffect(() => {
    void bootstrapSession().finally(() => setBooted(true));
  }, []);

  const ready = themeReady && booted && authReady && (fontsLoaded || Boolean(fontError));

  useEffect(() => {
    // Held until the theme is known as well as the session: hiding the splash
    // first shows a light screen to a dark-mode user for one frame, which is
    // the flash the web app's init-before-render exists to prevent.
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
        {ready ? (
          <KeyboardAwareApp>
            <Routes />
          </KeyboardAwareApp>
        ) : (
          <View style={{ flex: 1, backgroundColor: rgb(theme.canvas) }} />
        )}
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function Routes() {
  const theme = useTheme();
  useAuthGate();
  useClearCacheOnUserChange();

  return (
    <Stack
      screenOptions={{
        // A native navigation header owns the safe-area inset on every route.
        // Its right-side wordmark leaves the existing title and back affordance
        // untouched, while making the brand persist across portal navigation.
        headerShown: true,
        contentStyle: { backgroundColor: rgb(theme.canvas) },
        // The header follows the theme rather than the platform default, or a
        // dark-mode user gets one white bar at the top of an otherwise dark
        // screen. `headerBackTitle` is emptied so a long title on the previous
        // screen does not push the chevron off the iOS bar.
        headerStyle: { backgroundColor: rgb(theme.surface) },
        headerTintColor: rgb(theme.brandStrong),
        headerTitleStyle: typeface({ color: rgb(theme.ink[900]), fontSize: 17, fontWeight: '600' }) as {
          color: string;
          fontSize: number;
          fontFamily: string;
        },
        headerBackTitle: '',
        headerShadowVisible: false,
        headerRight: () => (
          <View style={{ marginRight: 4 }}>
            <WowHeaderLogo />
          </View>
        ),
      }}
    >
      <Stack.Screen name="login" options={{ title: '' }} />
      <Stack.Screen name="register" options={{ title: '' }} />
      {/* The child tab navigator supplies the one shared header for its routes. */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

      {/*
        The screens pushed out of a tab, each with the platform's own header.
        A native header rather than a title drawn into the page: it brings the
        back button, the swipe-back gesture and the large-title collapse with
        it, and a hand-rolled one brings none of those and has to be told about
        the notch.

        The titles are the web app's own words, because a vendor who has used
        the site is looking for "Catalog & Services" and not for a synonym.
      */}
      <Stack.Screen
        name="business-details"
        options={{ headerShown: true, title: 'Business Details' }}
      />
      <Stack.Screen
        name="business-services"
        options={{ headerShown: true, title: 'Catalog & Services' }}
      />
      <Stack.Screen
        name="business-review"
        options={{ headerShown: true, title: 'Review & Submit' }}
      />
      <Stack.Screen name="accounts" options={{ headerShown: true, title: 'Accounts' }} />
      <Stack.Screen name="escrow" options={{ headerShown: true, title: 'Escrow' }} />
      <Stack.Screen name="agent-clients" options={{ headerShown: true, title: 'My Clients' }} />
      <Stack.Screen name="agent-onboard" options={{ headerShown: true, title: 'New Client' }} />
      <Stack.Screen name="account" options={{ headerShown: true, title: 'Account Information' }} />
      <Stack.Screen name="profile" options={{ headerShown: true, title: 'My Profile' }} />
      <Stack.Screen name="edit-profile" options={{ headerShown: true, title: 'Edit Profile' }} />
      <Stack.Screen name="photos" options={{ headerShown: true, title: 'Photos' }} />
      <Stack.Screen
        name="preferences"
        options={{ headerShown: true, title: 'Partner Preferences' }}
      />
      <Stack.Screen name="identity" options={{ headerShown: true, title: 'Verification' }} />
      <Stack.Screen name="shortlisted" options={{ headerShown: true, title: 'Shortlisted' }} />
      <Stack.Screen name="privacy" options={{ headerShown: true, title: 'Privacy & Safety' }} />
      <Stack.Screen name="blocked" options={{ headerShown: true, title: 'Blocked Profiles' }} />
      <Stack.Screen name="support" options={{ headerShown: true, title: 'Support' }} />
      <Stack.Screen name="security" options={{ headerShown: true, title: 'Security' }} />
      <Stack.Screen name="my-reviews" options={{ headerShown: true, title: 'My Reviews' }} />
      <Stack.Screen name="planner-clients" options={{ headerShown: true, title: 'My Weddings' }} />
      <Stack.Screen
        name="planner-requests/index"
        options={{ headerShown: true, title: 'Planner Requests' }}
      />
      <Stack.Screen name="planner-requests/[id]" options={{ headerShown: true, title: 'Request' }} />
      <Stack.Screen name="about" options={{ headerShown: true, title: 'About WOW' }} />
      <Stack.Screen
        name="transaction/[id]"
        options={{ headerShown: true, title: 'Payment' }}
      />
      <Stack.Screen name="biodata" options={{ headerShown: true, title: 'Biodata' }} />
      <Stack.Screen name="events" options={{ headerShown: true, title: 'Events' }} />
      <Stack.Screen name="plan/[id]" options={{ headerShown: true, title: 'My Wedding Plan' }} />
      <Stack.Screen name="plan/budget" options={{ headerShown: true, title: 'Budget' }} />
      <Stack.Screen name="plan/guests" options={{ headerShown: true, title: 'Guest List' }} />
      <Stack.Screen name="plan/bookings" options={{ headerShown: true, title: 'Bookings' }} />
      <Stack.Screen
        name="plan/services"
        options={{ headerShown: true, title: 'Additional Services' }}
      />
      <Stack.Screen name="plan/more" options={{ headerShown: true, title: 'Plan More' }} />
      <Stack.Screen name="vendors/index" options={{ headerShown: true, title: 'Vendors' }} />
      <Stack.Screen name="vendors/[id]" options={{ title: 'Vendor' }} />
      <Stack.Screen
        name="vendors/[id]/gallery"
        options={{ headerShown: true, title: 'Photos' }}
      />
      <Stack.Screen
        name="planners/index"
        options={{ headerShown: true, title: 'Hire a Planner' }}
      />
      <Stack.Screen name="planners/[id]" options={{ title: 'Wedding Planner' }} />
      <Stack.Screen
        name="planners/[id]/weddings/index"
        options={{ headerShown: true, title: 'Previous Weddings' }}
      />
      {/* Retitled with the couple's names once the wedding has loaded. */}
      <Stack.Screen
        name="planners/[id]/weddings/[weddingId]"
        options={{ headerShown: true, title: 'Wedding' }}
      />
      <Stack.Screen name="planners/[id]/reviews" options={{ headerShown: true, title: 'Reviews' }} />
      <Stack.Screen
        name="planners/[id]/request"
        options={{ headerShown: true, title: 'Send Request' }}
      />
      {/* The title becomes the other person's name once the thread knows it. */}
      <Stack.Screen name="chat/index" options={{ headerShown: true, title: 'Chat' }} />
      {/* These routes retain their specialised headers; the shared mark is rendered in them. */}
      <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="match/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="visit/[id]" options={{ headerShown: true, title: 'Visit' }} />
      <Stack.Screen name="case/[id]" options={{ headerShown: true, title: 'Case' }} />
      <Stack.Screen name="rsvp/[token]" options={{ headerShown: true, title: 'Invitation' }} />
    </Stack>
  );
}
