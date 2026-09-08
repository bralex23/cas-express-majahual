import React from 'react';
import { TouchableOpacity, View, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { actionGradientStyle } from '../theme';

interface ActionButtonProps {
  icon?: string;
  label?: string;
  color: string;
  textColor?: string;   // default '#fff'
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  flex?: boolean;
  style?: any;
}

export default function ActionButton({
  icon, label, color, textColor = '#fff',
  onPress, loading, disabled, compact, flex, style,
}: ActionButtonProps) {
  const isDisabled = disabled || loading;
  const gradStyle  = actionGradientStyle(color);

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      style={[
        styles.btn,
        compact && styles.compact,
        flex   && styles.flex,
        gradStyle,
        isDisabled && styles.disabled,
        style,
      ]}
      activeOpacity={0.78}
    >
      {loading ? (
        <ActivityIndicator size={compact ? 14 : 16} color={textColor} />
      ) : icon ? (
        <MaterialCommunityIcons name={icon as any} size={compact ? 15 : 17} color={textColor} />
      ) : null}
      {label ? (
        <Text style={[styles.label, { color: textColor }, compact && styles.labelCompact]}>
          {label}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    minHeight: 38,
  },
  compact: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    minHeight: 30,
    gap: 4,
  },
  flex: {
    flex: 1,
  },
  disabled: {
    opacity: 0.52,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  labelCompact: {
    fontSize: 11,
  },
});
