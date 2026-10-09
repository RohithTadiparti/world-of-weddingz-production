import Constants from 'expo-constants';

export function getApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (__DEV__) {
    const expoHost = Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost';
    return `http://${expoHost}:3000/api`;
  }
  throw new Error('EXPO_PUBLIC_API_URL is not set for this build, so the app has no API to talk to.');
}
