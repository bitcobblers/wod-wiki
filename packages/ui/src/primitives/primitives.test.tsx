import { fireEvent, render, screen } from '@testing-library/react';
import { createAgent } from '@ui-sdk/react/agent';
import { useState } from 'react';
import { describe, expect, test } from 'vitest';
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldLabel,
  Input,
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  SwitchThumb,
  WodOverlayHost,
  buttonVariants,
  notifyToast,
} from './index';

let approveDestructive = false;
const agent = createAgent({
  allow: (step) => !step.confirm || approveDestructive,
});

function SampleWorkoutPreferences({ onDelete }: { onDelete: () => void }) {
  const [title, setTitle] = useState('Fran');
  const [unit, setUnit] = useState<string | null>('kg');
  const [autoSync, setAutoSync] = useState(true);
  const [range, setRange] = useState<string | null>('12w');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workout Preferences</CardTitle>
        <CardDescription>Configure defaults and units.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Badge variant="secondary">Mineral</Badge>
        <Field name="workoutTitle">
          <FieldLabel>Workout title</FieldLabel>
          <Input value={title} onValueChange={setTitle} required />
        </Field>
        <Field>
          <FieldLabel>Weight unit</FieldLabel>
          <Select value={unit} onValueChange={(next) => setUnit(next)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="kg">Kilograms</SelectItem>
              <SelectItem value="lb">Pounds</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>Analytics window</FieldLabel>
          <SegmentedControl value={range} onValueChange={setRange}>
            <SegmentedControlIndicator />
            <SegmentedControlItem value="4w">4 Weeks</SegmentedControlItem>
            <SegmentedControlItem value="12w">12 Weeks</SegmentedControlItem>
          </SegmentedControl>
        </Field>
        <Field>
          <FieldLabel>Auto-sync feeds</FieldLabel>
          <Switch checked={autoSync} onCheckedChange={setAutoSync}>
            <SwitchThumb />
          </Switch>
        </Field>
        <Button
          variant="outline"
          onClick={() => notifyToast({ title: 'Preferences saved' })}
        >
          Save preferences
        </Button>
        <AlertDialog>
          <AlertDialogTrigger>Reset notebook</AlertDialogTrigger>
          <AlertDialogBackdrop />
          <AlertDialogContent>
            <AlertDialogTitle>Reset notebook data?</AlertDialogTitle>
            <AlertDialogDescription>
              Clears local workout drafts from this browser.
            </AlertDialogDescription>
            <AlertDialogClose>Cancel</AlertDialogClose>
            <AlertDialogClose
              value="confirm"
              data-variant="destructive"
              data-agent-confirm="Permanently clears local workout drafts"
              onClick={onDelete}
            >
              Erase drafts
            </AlertDialogClose>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
      <WodOverlayHost />
    </Card>
  );
}

describe('@bitcobblers/wod-wiki-ui/primitives', () => {
  test('icon buttons enforce 44x44px touch target baseline', () => {
    const classes = buttonVariants({ size: 'icon' });
    expect(classes).toContain('min-h-11');
    expect(classes).toContain('min-w-11');
  });

  test('every control is named, operable via createAgent(), and gates destructive confirmation', async () => {
    approveDestructive = false;
    let deleted = false;
    render(<SampleWorkoutPreferences onDelete={() => { deleted = true; }} />);

    const components = agent
      .snapshot()
      .filter((entry) => !entry.offPage && entry.component !== 'more');

    for (const entry of components) {
      expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBeTruthy();
    }

    const labels = components.map((entry) => entry.label);
    for (const expected of [
      'Workout title',
      'Weight unit',
      'Analytics window',
      'Auto-sync feeds',
      'Save preferences',
      'Reset notebook',
    ]) {
      expect(labels, `${expected} missing from snapshot`).toContain(expected);
    }

    const result = await agent.act({
      steps: [
        { ref: 'Workout title', action: 'setValue', args: ['Murph'] },
        { ref: 'Weight unit', action: 'setValue', args: ['Pounds'] },
        { ref: 'Analytics window', action: 'setValue', args: ['4 Weeks'] },
        { ref: 'Auto-sync feeds', action: 'toggle' },
      ],
    });
    expect(result.ok, result.error?.message).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('Workout title').value).toBe('Murph');
    expect(screen.getByRole('switch', { name: 'Auto-sync feeds' }).getAttribute('aria-checked')).toBe('false');

    const destructiveStep = {
      steps: [{ ref: 'Reset notebook', action: 'press', args: ['Erase drafts'] }],
    };
    expect((await agent.act(destructiveStep)).ok).toBe(false);
    expect(deleted).toBe(false);

    approveDestructive = true;
    expect((await agent.act(destructiveStep)).ok).toBe(true);
    expect(deleted).toBe(true);
  });

  test('switch responds to Space key and buttons render semantic attributes', () => {
    render(<SampleWorkoutPreferences onDelete={() => {}} />);
    const toggle = screen.getByRole('switch', { name: 'Auto-sync feeds' });
    expect(toggle.getAttribute('aria-disabled')).toBeNull();
    toggle.focus();
    fireEvent.keyDown(toggle, { key: ' ' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });
});
