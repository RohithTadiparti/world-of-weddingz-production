import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

/**
 * The single keyboard policy for every route in the app.
 *
 * Screens retain their own ScrollView, FlatList, modal and chat composition;
 * shrinking the navigation root gives each existing scroll container a real
 * viewport when the keyboard appears. iOS pads the root around the keyboard;
 * Android uses native resize mode (declared in app.json), including inputs in
 * sheets and dialogs.
 */
export function KeyboardAwareApp({ children }: { children: ReactNode }) {
  if (Platform.OS === 'ios') {
    return (
      <KeyboardAvoidingView style={styles.root} behavior="padding">
        {children}
      </KeyboardAvoidingView>
    );
  }

  return <View style={styles.root}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
