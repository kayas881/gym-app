import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  StyleSheet,
  StyleProp,
  ViewStyle,
  TextStyle,
  KeyboardTypeOptions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme';

export interface InputProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  secureTextEntry?: boolean;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  maxLength?: number;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  editable?: boolean;
  onBlur?: TextInputProps['onBlur'];
  onFocus?: TextInputProps['onFocus'];
  returnKeyType?: 'done' | 'go' | 'next' | 'search' | 'send';
  onSubmitEditing?: () => void;
  testID?: string;
}

export default function Input({
  label,
  placeholder,
  value,
  onChangeText,
  secureTextEntry = false,
  error,
  leftIcon,
  rightIcon,
  keyboardType = 'default',
  autoCapitalize = 'none',
  autoCorrect = true,
  multiline = false,
  numberOfLines = 1,
  maxLength,
  style,
  inputStyle,
  editable = true,
  onBlur,
  onFocus,
  returnKeyType,
  onSubmitEditing,
  testID,
}: InputProps) {
  const { colors } = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const [isPasswordHidden, setIsPasswordHidden] = useState(secureTextEntry);

  const handleFocus: TextInputProps['onFocus'] = (e) => {
    setIsFocused(true);
    onFocus?.(e);
  };

  const handleBlur: TextInputProps['onBlur'] = (e) => {
    setIsFocused(false);
    onBlur?.(e);
  };

  // Determine dynamic border color
  let borderColor: string = colors.inputBorder;
  if (error) {
    borderColor = colors.error;
  } else if (isFocused) {
    borderColor = colors.primary;
  }

  const containerDynamicStyle: ViewStyle = {
    backgroundColor: colors.inputBackground,
    borderColor,
    opacity: editable ? 1 : 0.6,
  };

  return (
    <View style={[styles.wrapper, style]}>
      {label ? (
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.inputContainer,
          multiline ? styles.multilineContainer : styles.singleLineContainer,
          containerDynamicStyle,
        ]}
      >
        {leftIcon ? (
          <View style={styles.leftIconContainer}>{leftIcon}</View>
        ) : null}

        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.inputPlaceholder}
          secureTextEntry={secureTextEntry ? isPasswordHidden : false}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          multiline={multiline}
          numberOfLines={numberOfLines}
          maxLength={maxLength}
          editable={editable}
          onFocus={handleFocus}
          onBlur={handleBlur}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          testID={testID}
          style={[
            styles.input,
            { color: colors.text },
            multiline && styles.multilineInput,
            inputStyle,
          ]}
        />

        {secureTextEntry ? (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setIsPasswordHidden((prev) => !prev)}
            style={styles.rightIconContainer}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={isPasswordHidden ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        ) : rightIcon ? (
          <View style={styles.rightIconContainer}>{rightIcon}</View>
        ) : null}
      </View>

      {error ? (
        <Text style={[styles.errorText, { color: colors.error }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 6,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  singleLineContainer: {
    height: 48,
  },
  multilineContainer: {
    minHeight: 80,
    paddingVertical: 10,
    alignItems: 'flex-start',
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
    height: '100%',
  },
  multilineInput: {
    height: 'auto',
    textAlignVertical: 'top',
  },
  leftIconContainer: {
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightIconContainer: {
    marginLeft: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 12,
    marginTop: 4,
    fontWeight: '400',
  },
});
