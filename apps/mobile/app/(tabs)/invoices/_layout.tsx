import { Stack } from 'expo-router';

export default function InvoicesStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen name="index" options={{ title: 'Invoices' }} />
      <Stack.Screen name="[id]" options={{ title: 'Invoice' }} />
      <Stack.Screen name="new" options={{ title: 'New Invoice', presentation: 'modal' }} />
    </Stack>
  );
}
