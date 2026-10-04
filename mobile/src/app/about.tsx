import { useEffect } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { useLocalSearchParams, useNavigation } from 'expo-router';

import { DetailGrid, DetailRow } from '@/components/chrome';
import { Body, Caption, Card, Screen, SectionTitle } from '@/components/ui';
import { space } from '@/theme';

type AboutType = 'about' | 'terms' | 'privacy';

const TITLES: Record<AboutType, string> = {
  about: 'About WOW',
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
};

export default function About() {
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ type?: string }>();
  const type: AboutType =
    params.type === 'terms' || params.type === 'privacy' ? params.type : 'about';

  useEffect(() => {
    navigation.setOptions({ title: TITLES[type] });
  }, [navigation, type]);

  const expo = Constants.expoConfig;
  const build =
    Platform.OS === 'ios'
      ? (expo?.ios?.buildNumber ?? null)
      : (expo?.android?.versionCode?.toString() ?? null);

  if (type === 'terms') {
    return (
      <Screen>
        <Caption tone="faint">Last updated: 1 Jan 2026</Caption>
        <Card>
          <SectionTitle>1. Acceptance</SectionTitle>
          <Body tone="muted">
            These terms govern your use of World of Weddingz. Using the app means you agree to them.
            If you do not agree, do not create an account or continue to use the service.
          </Body>
        </Card>
        <Card>
          <SectionTitle>2. Use of the Service</SectionTitle>
          <Body tone="muted">
            You must be 18 or older. Profiles and messages must be truthful. You may not impersonate
            another person, harvest contacts, or use the platform to advertise unrelated services.
          </Body>
        </Card>
        <Card>
          <SectionTitle>3. Matches and conversations</SectionTitle>
          <Body tone="muted">
            Interests, matches and chat are between the people involved. WOW does not guarantee a
            match, a marriage, or the conduct of anybody you meet through the app.
          </Body>
        </Card>
        <Card>
          <SectionTitle>4. Verification</SectionTitle>
          <Body tone="muted">
            Identity checks, including Aadhaar OTP and an in-person document review, confirm that a
            document belongs to a profile. They are not a character reference.
          </Body>
        </Card>
        <Card>
          <SectionTitle>5. Ending use</SectionTitle>
          <Body tone="muted">
            You may sign out at any time. Closing the account for good is offered on the web app,
            where the full record can be reviewed before it is erased.
          </Body>
        </Card>
      </Screen>
    );
  }

  if (type === 'privacy') {
    return (
      <Screen>
        <Caption tone="faint">Last updated: 1 Jan 2026</Caption>
        <Card>
          <SectionTitle>1. Information We Collect</SectionTitle>
          <Body tone="muted">
            Account details (email, mobile), the matrimony profile you write, photographs you
            upload, interests and messages, wedding events you create, and the device used to sign
            in.
          </Body>
        </Card>
        <Card>
          <SectionTitle>2. How We Use Information</SectionTitle>
          <Body tone="muted">
            To run matchmaking, deliver chat, plan wedding events, verify identity, send notices you
            have asked for, and investigate reports. We do not sell your profile.
          </Body>
        </Card>
        <Card>
          <SectionTitle>3. Data Security</SectionTitle>
          <Body tone="muted">
            Identity document numbers are hashed and discarded after the last four digits are kept.
            Access is limited to what each account is allowed to do. A leaked password should be
            changed immediately from Account Information.
          </Body>
        </Card>
        <Card>
          <SectionTitle>4. Your choices</SectionTitle>
          <Body tone="muted">
            Profile visibility is yours to set. You can block a match from Interests. A copy of
            everything held about you, and account erasure, are on the web app.
          </Body>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <SectionTitle>WOW</SectionTitle>
        <Body style={{ marginBottom: space(2) }}>Where Families Find Forever</Body>
        <DetailGrid>
          <DetailRow label="Version">{expo?.version ?? '1.0.0'}</DetailRow>
          {build ? <DetailRow label="Build">{build}</DetailRow> : null}
          <DetailRow label="Platform">
            {Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : 'Web'}
          </DetailRow>
        </DetailGrid>
      </Card>

      <Card>
        <SectionTitle>What it is for</SectionTitle>
        <Body tone="muted">
          World of Weddingz helps families find a match, talk once both sides accept, verify who
          they are speaking to, and plan the wedding that follows — in one place.
        </Body>
      </Card>

      <Caption tone="faint">© {new Date().getFullYear()} World of Weddingz</Caption>
    </Screen>
  );
}
