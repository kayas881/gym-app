import React, { useMemo } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useTheme } from '../lib/theme';
import { toIndianDate } from '../utils/date';

type Point = {
  date: string;
  value: number;
};

type Props = {
  title: string;
  points: Point[];
  suffix?: string;
};

export default function ProgressLineChart({ title, points, suffix = '' }: Props) {
  const { colors, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(width - 48, 260);

  const chart = useMemo(() => {
    if (points.length < 2) return null;
    const recent = points.slice(-12);
    return {
      labels: recent.map((point) => {
        const indian = toIndianDate(point.date);
        return indian.slice(0, 5);
      }),
      values: recent.map((point) => point.value),
    };
  }, [points]);

  return (
    <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {!chart ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          Need two sessions to draw this.
        </Text>
      ) : (
        <LineChart
          data={{
            labels: chart.labels,
            datasets: [{ data: chart.values }],
          }}
          width={chartWidth}
          height={176}
          yAxisSuffix={suffix ? ` ${suffix}` : ''}
          bezier
          fromZero
          withInnerLines={false}
          withOuterLines={false}
          withShadow={false}
          chartConfig={{
            backgroundColor: colors.card,
            backgroundGradientFrom: colors.card,
            backgroundGradientTo: colors.card,
            decimalPlaces: 1,
            color: () => colors.primary,
            labelColor: () => colors.textTertiary,
            propsForDots: {
              r: '3.5',
              strokeWidth: '2',
              stroke: colors.primary,
              fill: isDark ? '#11170B' : '#FFFFFF',
            },
            propsForBackgroundLines: { stroke: colors.divider },
          }}
          style={styles.chart}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: 20,
    paddingTop: 14,
    paddingBottom: 4,
    marginBottom: 12,
    overflow: 'hidden',
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  empty: {
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  chart: {
    marginLeft: -12,
  },
});
