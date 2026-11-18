import {
  Input as UiSdkInput,
  InputClear,
  InputGroup,
} from '@ui-sdk/react/input';
import type * as React from 'react';

export type InputProps = React.ComponentPropsWithRef<typeof UiSdkInput>;

export function Input({
  onChange,
  onValueChange,
  ...props
}: InputProps): React.JSX.Element | null {
  return (
    <UiSdkInput
      {...props}
      onValueChange={onValueChange}
      onChange={(event) => {
        // Testing Library's fireEvent.change dispatches 'change' without 'input'; forward so @ui-sdk/core's input listener runs.
        if (event.nativeEvent.type === 'change' && onValueChange) {
          event.currentTarget.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }
        onChange?.(event);
      }}
    />
  );
}

export { InputClear, InputGroup };
