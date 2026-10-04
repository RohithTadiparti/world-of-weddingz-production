import AsyncStorage from '@react-native-async-storage/async-storage';

const VENDOR_KEY = 'wow:vendor-shortlist';
const PLANNER_KEY = 'wow:planner-shortlist';

async function read(key: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

async function write(key: string, ids: Set<string>) {
  await AsyncStorage.setItem(key, JSON.stringify([...ids]));
}

export async function loadVendorShortlist() {
  return read(VENDOR_KEY);
}

export async function toggleVendorShortlist(id: string) {
  const set = await read(VENDOR_KEY);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  await write(VENDOR_KEY, set);
  return set;
}

export async function loadPlannerShortlist() {
  return read(PLANNER_KEY);
}

export async function togglePlannerShortlist(id: string) {
  const set = await read(PLANNER_KEY);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  await write(PLANNER_KEY, set);
  return set;
}
