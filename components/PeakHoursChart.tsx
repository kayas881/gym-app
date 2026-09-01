import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { BarChart } from 'react-native-chart-kit';
import { Ionicons } from '@expo/vector-icons';
import { useAppAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';

// Gym-hours window to plot. Bucketing the full 24h wastes most of the width on
// hours a gym is never open.
const FIRST_HOUR = 5;
const LAST_HOUR = 21;
const BAR_WIDTH = 34;

interface PeakHourRow {
  hour_of_day: number;
  check_in_count: number;
}

/** 15 -> "3p", 5 -> "5a", 12 -> "12p" */
function formatHourLabel(hour: number): string {
  const suffix = hour < 12 ? 'a' : 'p';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${suffix}`;
}

/** 15 -> "3-4 PM" */
function formatHourRange(hour: number): string {
  const label = (h: number) => {
    const twelve = h % 12 === 0 ? 12 : h % 12;
    return `${twelve}${h < 12 ? ' AM' : ' PM'}`;
  };
  const start = hour % 12 === 0 ? 12 : hour % 12;
  return `${start}-${label(hour + 1)}`;
}

interface PeakHoursChartProps {
  /** How far back to aggregate. */
  daysBack?: number;
}

export default function PeakHoursChart({ daysBack = 30 }: PeakHoursChartProps) {
  const { gymId, supabase } = useAppAuth();
  const { colors, isDark } = useTheme();

  const [rows, setRows] = useState<PeakHourRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPeakHours = useCallback(async () => {
    if (!gymId) {
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase.rpc('gym_peak_hours', {
        target_gym_id: gymId,
        days_back: daysBack,
      });
      if (error) {
        console.error('[PeakHours] fetch error:', error);
        return;
      }
      setRows((data as PeakHourRow[]) ?? []);
    } catch (err) {
      console.error('[PeakHours] unexpected error:', err);
    } finally {
      setLoading(false);
    }
  }, [gymId, supabase, daysBack]);

  useEffect(() => {
    fetchPeakHours();
  }, [fetchPeakHours]);

  // Fill every hour in the window so gaps render as empty bars rather than
  // collapsing the axis and misaligning labels.
  const { labels, values, total, busiestHour } = useMemo(() => {
    const counts = new Map(rows.map((r) => [Number(r.hour_of_day), Number(r.check_in_count)]));
    const hours: number[] = [];
    for (let h = FIRST_HOUR; h <= LAST_HOUR; h++) hours.push(h);

    const vals = hours.map((h) => counts.get(h) ?? 0);
    const sum = vals.reduce((a, b) => a + b, 0);

    let peak: number | null = null;
    let peakCount = 0;
    for (const [hour, count] of counts.entries()) {
      if (count > peakCount) {
        peakCount = count;
        peak = hour;
      }
    }

    return {
      labels: hours.map(formatHourLabel),
      values: vals,
      total: sum,
      busiestHour: peak,
    };
  }, [rows]);

  // chart-kit renders 4 y-axis segments by default. With a max of 1 check-in
  // that produced duplicate labels ("1 1 1 0 0"), so scale the segment count
  // to the data instead.
  const maxValue = Math.max(...values, 0);
  const segments = Math.max(1, Math.min(4, maxValue));

  const chartConfig = {
    backgroundGradientFrom: colors.surface,
    backgroundGradientTo: colors.surface,
    decimalPlaces: 0,
    // chart-kit passes opacity; keep the bars on-brand.
    color: (opacity = 1) => `rgba(0, 200, 120, ${opacity})`,
    labelColor: () => (isDark ? '#9BA1A6' : '#687076'),
    barPercentage: 0.55,
    propsForBackgroundLines: {
      stroke: colors.border,
      strokeDasharray: '4',
    },
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.text }]}>Peak Hours</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {busiestHour !== null
              ? `Busiest around ${formatHourRange(busiestHour)}`
              : `Last ${daysBack} days`}
          </Text>
        </View>
        <Ionicons name="bar-chart-outline" size={20} color={colors.textTertiary} />
      </View>

      {loading ? (
        <View style={styles.stateBox}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : total === 0 ? (
        <View style={styles.stateBox}>
          <Ionicons name="analytics-outline" size={28} color={colors.textTertiary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No check-ins yet. Once members start scanning the check-in code,
            busy hours will show up here.
          </Text>
        </View>
      ) : (
        // 17 hourly bars don't fit a phone width, so scroll rather than
        // squashing the labels into illegibility.
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <BarChart
            data={{ labels, datasets: [{ data: values }] }}
            width={labels.length * BAR_WIDTH + 60}
            height={200}
            fromZero
            segments={segments}
            showValuesOnTopOfBars
            withInnerLines
            yAxisLabel=""
            yAxisSuffix=""
            chartConfig={chartConfig}
            style={styles.chart}
          />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerText: { flex: 1 },
  title: { fontSize: 16, fontWeight: '700' },
  subtitle: { fontSize: 13, marginTop: 2 },
  stateBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    gap: 10,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  chart: { marginLeft: -8, borderRadius: 12 },
});
