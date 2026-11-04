import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../lib/theme';
import { type MuscleShare, formatVolume, muscleLabel } from '../lib/workout-progress';

type Props = {
  muscles: MuscleShare[];
};

export default function MuscleDistribution({ muscles }: Props) {
  const { colors } = useTheme();
  const volumeTotal = muscles.reduce((sum, row) => sum + (row.volume ?? 0), 0);

  if (muscles.length === 0) {
    return (
      <Text style={[styles.empty, { color: colors.textSecondary }]}>
        No muscle-group data for this period.
      </Text>
    );
  }

  return (
    <View style={styles.list}>
      {muscles.map((row) => {
        const share = volumeTotal > 0 && row.volume !== null ? row.volume / volumeTotal : 0;
        return (
          <View key={row.group} style={styles.row}>
            <View style={styles.labelRow}>
              <Text style={[styles.name, { color: colors.text }]}>{muscleLabel(row.group)}</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {row.primarySetCount} primary
                {row.secondarySetCount > 0 ? ` · ${row.secondarySetCount} secondary` : ''}
                {row.volume !== null ? ` · ${formatVolume(row.volume)}` : ''}
              </Text>
            </View>
            <View style={[styles.track, { backgroundColor: colors.surfaceElevated }]}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${Math.max(share * 100, row.setCount > 0 ? 4 : 0)}%`,
                    backgroundColor: row.group === 'unclassified' ? colors.textTertiary : colors.primary,
                  },
                ]}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  row: { gap: 6 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'flex-end' },
  name: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  meta: { fontSize: 11, flexShrink: 1, textAlign: 'right' },
  track: { height: 8, borderRadius: 99, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 99 },
  empty: { fontSize: 13, lineHeight: 18 },
});
