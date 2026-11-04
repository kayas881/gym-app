import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../lib/theme';
import {
  groupLibraryByMuscle,
  searchLibrary,
  type LibraryExercise,
} from '../lib/exercise-library';
import Input from './ui/Input';

type Props = {
  library: LibraryExercise[];
  addedKeys: Set<string>;
  onPick: (exercise: LibraryExercise) => void;
};

export default function ExercisePicker({ library, addedKeys, onPick }: Props) {
  const { colors } = useTheme();
  const groups = useMemo(() => groupLibraryByMuscle(library), [library]);
  const [groupKey, setGroupKey] = useState(groups[0]?.key ?? 'chest');
  const [query, setQuery] = useState('');

  const searching = query.trim().length > 0;
  const hits = useMemo(() => {
    if (searching) return searchLibrary(query, library).slice(0, 16);
    return groups.find((group) => group.key === groupKey)?.exercises ?? groups[0]?.exercises ?? [];
  }, [groupKey, groups, library, query, searching]);

  return (
    <View style={styles.wrap}>
      <Input
        label="Search a specific lift"
        value={query}
        onChangeText={setQuery}
        placeholder="Landmine press, cable crunch…"
        autoCorrect={false}
      />
      {searching ? (
        <Text style={[styles.hint, { color: colors.textTertiary }]}>
          Search is for names that are not in the groups below.
        </Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="handled"
        >
          {groups.map((group) => {
            const selected = group.key === groupKey;
            return (
              <TouchableOpacity
                key={group.key}
                onPress={() => setGroupKey(group.key)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? colors.primary : colors.surfaceElevated,
                    borderColor: selected ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: selected ? '#11170B' : colors.text }]}>
                  {group.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
      {hits.map((item) => {
        const added = addedKeys.has(item.key);
        return (
          <TouchableOpacity
            key={item.key}
            disabled={added}
            onPress={() => onPick(item)}
            style={[
              styles.hit,
              {
                borderColor: colors.border,
                backgroundColor: added ? colors.surface : colors.surfaceElevated,
              },
            ]}
          >
            <View style={styles.hitText}>
              <Text style={[styles.hitName, { color: added ? colors.textTertiary : colors.text }]}>
                {item.name}
              </Text>
              <Text style={[styles.hitMeta, { color: colors.textTertiary }]}>
                {item.equipment}
                {item.custom ? ' · custom' : ''}
              </Text>
            </View>
            <Text style={[styles.hitState, { color: added ? colors.primary : colors.textSecondary }]}>
              {added ? 'Added' : 'Add'}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  hint: { fontSize: 12, lineHeight: 16 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: 13, fontWeight: '700' },
  hit: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  hitText: { flex: 1 },
  hitName: { fontSize: 15, fontWeight: '700' },
  hitMeta: { fontSize: 12, marginTop: 2 },
  hitState: { fontSize: 12, fontWeight: '700' },
});
