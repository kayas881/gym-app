/**
 * Built-in exercise catalog plus helpers for custom names.
 *
 * Muscle groups match Progress / Session Intelligence. Unknown names stay
 * unclassified rather than guessing.
 */

export type LibraryCategory = 'compound' | 'isolation' | 'core';
export type LibraryEquipment =
  | 'barbell'
  | 'dumbbell'
  | 'cable'
  | 'machine'
  | 'bodyweight'
  | 'other';

export type LibraryExercise = {
  key: string;
  name: string;
  primary: string;
  secondary: string[];
  category: LibraryCategory;
  equipment: LibraryEquipment;
  instructions: string;
  custom: boolean;
};

function entry(
  name: string,
  primary: string,
  secondary: string[],
  category: LibraryCategory,
  equipment: LibraryEquipment,
  instructions: string,
): LibraryExercise {
  return {
    key: name.trim().replace(/\s+/g, ' ').toLowerCase(),
    name,
    primary,
    secondary,
    category,
    equipment,
    instructions,
    custom: false,
  };
}

export const BUILTIN_EXERCISES: LibraryExercise[] = [
  entry('Bench press', 'chest', ['triceps', 'shoulders'], 'compound', 'barbell', 'Lie on a bench and press the bar from the chest to lockout.'),
  entry('Incline bench press', 'chest', ['triceps', 'shoulders'], 'compound', 'barbell', 'Press on a low incline so the upper chest takes more of the load.'),
  entry('Decline bench press', 'chest', ['triceps'], 'compound', 'barbell', 'Press on a decline bench, lowering under control to the chest.'),
  entry('Chest press', 'chest', ['triceps', 'shoulders'], 'compound', 'machine', 'Sit tall and press the handles until the elbows are nearly straight.'),
  entry('Dumbbell fly', 'chest', [], 'isolation', 'dumbbell', 'Open the arms in a wide arc, then squeeze the chest to bring them together.'),
  entry('Cable fly', 'chest', [], 'isolation', 'cable', 'Keep a soft elbow and bring the handles together in front of the chest.'),
  entry('Push-up', 'chest', ['triceps', 'shoulders'], 'compound', 'bodyweight', 'Body in a straight line; lower the chest, then press the floor away.'),
  entry('Pull-up', 'back', ['biceps'], 'compound', 'bodyweight', 'Hang from a bar and pull until the chin clears it.'),
  entry('Chin-up', 'back', ['biceps'], 'compound', 'bodyweight', 'Underhand hang; pull until the chin is above the bar.'),
  entry('Lat pulldown', 'back', ['biceps'], 'compound', 'cable', 'Pull the bar to the upper chest without leaning too far back.'),
  entry('Barbell row', 'back', ['biceps'], 'compound', 'barbell', 'Hinge at the hips and row the bar to the lower ribs.'),
  entry('Dumbbell row', 'back', ['biceps'], 'compound', 'dumbbell', 'Brace on a bench and row the dumbbell to the hip.'),
  entry('Seated row', 'back', ['biceps'], 'compound', 'cable', 'Sit tall and pull the handle to the belly, squeezing the shoulder blades.'),
  entry('Deadlift', 'back', ['hamstrings', 'glutes'], 'compound', 'barbell', 'Push the floor away and stand tall with the bar close to the legs.'),
  entry('Romanian deadlift', 'hamstrings', ['glutes', 'back'], 'compound', 'barbell', 'Hinge until a stretch in the hamstrings, then stand by driving the hips.'),
  entry('Squat', 'quadriceps', ['glutes'], 'compound', 'barbell', 'Sit the hips down and back, then stand without the knees collapsing in.'),
  entry('Front squat', 'quadriceps', ['glutes'], 'compound', 'barbell', 'Bar on the front delts; stay tall as you squat.'),
  entry('Leg press', 'quadriceps', ['glutes'], 'compound', 'machine', 'Lower until the thighs are near the torso, then press through the whole foot.'),
  entry('Lunge', 'quadriceps', ['glutes'], 'compound', 'dumbbell', 'Step long, drop the back knee, then push back to standing.'),
  entry('Bulgarian split squat', 'quadriceps', ['glutes'], 'compound', 'dumbbell', 'Rear foot on a bench; drop straight down on the front leg.'),
  entry('Leg extension', 'quadriceps', [], 'isolation', 'machine', 'Extend the knees without swinging the torso.'),
  entry('Leg curl', 'hamstrings', [], 'isolation', 'machine', 'Curl the pad toward the glutes and lower slowly.'),
  entry('Hip thrust', 'glutes', ['hamstrings'], 'compound', 'barbell', 'Upper back on a bench; drive the hips to a straight line from knees to shoulders.'),
  entry('Calf raise', 'calves', [], 'isolation', 'machine', 'Rise onto the toes, pause, then lower through a full stretch.'),
  entry('Overhead press', 'shoulders', ['triceps'], 'compound', 'barbell', 'Press the bar from the shoulders to lockout without leaning back.'),
  entry('Shoulder press', 'shoulders', ['triceps'], 'compound', 'dumbbell', 'Press the dumbbells overhead until the elbows are straight.'),
  entry('Lateral raise', 'shoulders', [], 'isolation', 'dumbbell', 'Raise the arms to the side until they are about shoulder height.'),
  entry('Face pull', 'shoulders', ['back'], 'isolation', 'cable', 'Pull the rope to the face and rotate the hands back.'),
  entry('Barbell curl', 'biceps', [], 'isolation', 'barbell', 'Curl the bar without swinging the torso.'),
  entry('Hammer curl', 'biceps', [], 'isolation', 'dumbbell', 'Neutral grip; curl until the thumbs point at the shoulders.'),
  entry('Tricep pushdown', 'triceps', [], 'isolation', 'cable', 'Keep the elbows pinned and extend until the arms are straight.'),
  entry('Skull crusher', 'triceps', [], 'isolation', 'barbell', 'Lower the bar toward the forehead, then extend the elbows.'),
  entry('Dip', 'triceps', ['chest'], 'compound', 'bodyweight', 'Lower until the shoulders are at elbow height, then press up.'),
  entry('Plank', 'core', [], 'core', 'bodyweight', 'Hold a straight line from head to heels without sagging the hips.'),
  entry('Crunch', 'core', [], 'core', 'bodyweight', 'Curl the ribcage toward the hips; do not yank the neck.'),
  entry('Hanging leg raise', 'core', [], 'core', 'bodyweight', 'Raise the legs without swinging, then lower under control.'),
  entry('Russian twist', 'core', [], 'core', 'bodyweight', 'Rotate the torso from side to side while the chest stays tall.'),
];

export function exerciseLibraryKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function searchLibrary(
  query: string,
  extras: LibraryExercise[] = [],
): LibraryExercise[] {
  const needle = exerciseLibraryKey(query);
  const merged = mergeLibrary(extras);
  if (!needle) return merged;
  return merged.filter((item) =>
    item.key.includes(needle) ||
    item.primary.includes(needle) ||
    item.equipment.includes(needle),
  );
}

export function mergeLibrary(extras: LibraryExercise[]): LibraryExercise[] {
  const byKey = new Map<string, LibraryExercise>();
  for (const item of BUILTIN_EXERCISES) {
    byKey.set(item.key, item);
  }
  for (const item of extras) {
    if (!byKey.has(item.key)) {
      byKey.set(item.key, item);
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findLibraryExercise(
  name: string,
  extras: LibraryExercise[] = [],
): LibraryExercise | null {
  const key = exerciseLibraryKey(name);
  return mergeLibrary(extras).find((item) => item.key === key) ?? null;
}

export function isDuplicateExerciseName(
  name: string,
  extras: LibraryExercise[] = [],
): boolean {
  return findLibraryExercise(name, extras) !== null;
}

export const MUSCLE_PICKER_GROUPS: Array<{ key: string; label: string }> = [
  { key: 'chest', label: 'Chest' },
  { key: 'back', label: 'Back' },
  { key: 'shoulders', label: 'Shoulders' },
  { key: 'quadriceps', label: 'Quads' },
  { key: 'hamstrings', label: 'Hamstrings' },
  { key: 'glutes', label: 'Glutes' },
  { key: 'biceps', label: 'Biceps' },
  { key: 'triceps', label: 'Triceps' },
  { key: 'calves', label: 'Calves' },
  { key: 'core', label: 'Core' },
  { key: 'other', label: 'Other' },
];

export function musclePickerGroup(primary: string): string {
  const key = primary.trim().toLowerCase();
  return MUSCLE_PICKER_GROUPS.some((group) => group.key === key) ? key : 'other';
}

export function groupLibraryByMuscle(
  extras: LibraryExercise[] = [],
): Array<{ key: string; label: string; exercises: LibraryExercise[] }> {
  const merged = mergeLibrary(extras);
  const buckets = new Map<string, LibraryExercise[]>();
  for (const item of merged) {
    const key = musclePickerGroup(item.primary);
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }
  return MUSCLE_PICKER_GROUPS
    .map((group) => ({
      ...group,
      exercises: buckets.get(group.key) ?? [],
    }))
    .filter((group) => group.exercises.length > 0);
}
