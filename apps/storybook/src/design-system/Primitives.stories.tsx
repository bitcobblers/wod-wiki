import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
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
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
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
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Textarea,
  notifyToast,
  type BadgeVariant,
  type ButtonSize,
  type ButtonVariant,
} from '@bitcobblers/wod-wiki-ui/primitives';

function PrimitivesShowcase() {
  const [unit, setUnit] = useState<string | null>('kg');
  const [windowRange, setWindowRange] = useState<string | null>('12w');
  const [autoSync, setAutoSync] = useState(true);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 bg-background text-foreground">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>WOD Wiki UI-SDK Primitives</CardTitle>
            <div className="flex items-center gap-2">
              <Badge>Primary</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="destructive">Destructive</Badge>
            </div>
          </div>
          <CardDescription>
            Standardized interactive primitives powered by @ui-sdk/react and Mineral / Arctic Frost tokens.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => notifyToast({ title: 'Saved workout note' })}>
              Save Note
            </Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
            <Button disabled>Disabled</Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="title">
              <FieldLabel>Workout Title</FieldLabel>
              <Input defaultValue="Fran" />
              <FieldDescription>21-15-9 Thrusters &amp; Pull-ups</FieldDescription>
            </Field>

            <Field>
              <FieldLabel>Load Unit</FieldLabel>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kg">Kilograms (kg)</SelectItem>
                  <SelectItem value="lb">Pounds (lb)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field name="notes">
            <FieldLabel>Coaching Notes</FieldLabel>
            <Textarea defaultValue="Keep elbows high on thrusters; break pull-ups early." rows={2} />
          </Field>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <Field>
              <FieldLabel>Time Window</FieldLabel>
              <SegmentedControl value={windowRange} onValueChange={setWindowRange}>
                <SegmentedControlIndicator />
                <SegmentedControlItem value="4w">4W</SegmentedControlItem>
                <SegmentedControlItem value="12w">12W</SegmentedControlItem>
                <SegmentedControlItem value="52w">52W</SegmentedControlItem>
              </SegmentedControl>
            </Field>

            <Field className="flex-row items-center gap-3">
              <FieldLabel>Auto-sync Feeds</FieldLabel>
              <Switch checked={autoSync} onCheckedChange={setAutoSync}>
                <SwitchThumb />
              </Switch>
            </Field>
          </div>

          <Progress value={68}>
            <ProgressLabel>Seed Sync Progress</ProgressLabel>
            <ProgressValue />
            <ProgressTrack>
              <ProgressIndicator />
            </ProgressTrack>
          </Progress>

          <Collapsible>
            <CollapsibleTrigger>Toggle Advanced Feed Options</CollapsibleTrigger>
            <CollapsiblePanel className="pt-2 text-sm text-muted-foreground">
              Content-addressed static Markdown feeds sync locally into IndexedDB.
            </CollapsiblePanel>
          </Collapsible>

          <Tabs defaultValue="overlays">
            <TabsList aria-label="Component demos">
              <TabsTab value="overlays">Dialogs &amp; Menus</TabsTab>
              <TabsTab value="notes">Behavior Notes</TabsTab>
            </TabsList>
            <TabsPanel value="overlays" className="pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <Dialog>
                  <DialogTrigger>Open Dialog</DialogTrigger>
                  <DialogBackdrop />
                  <DialogContent>
                    <DialogTitle>Schedule Workout</DialogTitle>
                    <DialogDescription>
                      Assign this workout note to a journal date.
                    </DialogDescription>
                    <div className="mt-4 flex justify-end gap-2">
                      <DialogClose>Close</DialogClose>
                    </div>
                  </DialogContent>
                </Dialog>

                <Drawer>
                  <DrawerTrigger>Open Drawer</DrawerTrigger>
                  <DrawerBackdrop />
                  <DrawerContent>
                    <DrawerTitle>Quick Inspect</DrawerTitle>
                    <DrawerDescription>
                      Slide-over drawer for peeking efforts and note details.
                    </DrawerDescription>
                    <div className="mt-4 flex justify-end">
                      <DrawerClose>Done</DrawerClose>
                    </div>
                  </DrawerContent>
                </Drawer>

                <Popover>
                  <PopoverTrigger>Open Popover</PopoverTrigger>
                  <PopoverContent>
                    <PopoverTitle>Metric Origin</PopoverTitle>
                    <PopoverDescription>
                      Parsed from Whiteboard script; overridden by live runtime.
                    </PopoverDescription>
                  </PopoverContent>
                </Popover>

                <Menu>
                  <MenuTrigger>Note Actions</MenuTrigger>
                  <MenuContent>
                    <MenuItem value="duplicate">Duplicate note</MenuItem>
                    <MenuItem value="export">Export Markdown</MenuItem>
                    <MenuSeparator />
                    <MenuItem value="archive">Archive</MenuItem>
                  </MenuContent>
                </Menu>

                <AlertDialog>
                  <AlertDialogTrigger data-variant="destructive">
                    Delete Workout
                  </AlertDialogTrigger>
                  <AlertDialogBackdrop />
                  <AlertDialogContent>
                    <AlertDialogTitle>Delete workout permanently?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes the workout note and its local drafts.
                    </AlertDialogDescription>
                    <div className="mt-4 flex justify-end gap-2">
                      <AlertDialogClose>Cancel</AlertDialogClose>
                      <AlertDialogClose
                        value="confirm"
                        data-variant="destructive"
                        data-agent-confirm="Permanently deletes the workout note"
                      >
                        Delete Forever
                      </AlertDialogClose>
                    </div>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </TabsPanel>
            <TabsPanel value="notes" className="pt-4 text-sm text-muted-foreground">
              All popups render in the browser top layer without z-index portals.
            </TabsPanel>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

const meta: Meta<typeof PrimitivesShowcase> = {
  title: 'Design System/UI-SDK Primitives',
  component: PrimitivesShowcase,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
};

export default meta;
type Story = StoryObj<typeof PrimitivesShowcase>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialogTrigger = canvas.getByRole('button', { name: 'Open Dialog' });
    await userEvent.click(dialogTrigger);
    const closeBtn = await within(document.body).findByRole('button', { name: 'Close' });
    await userEvent.click(closeBtn);
    await expect(dialogTrigger).toHaveFocus();
  },
};

export const ButtonPropertyMatrix: StoryObj<{
  variant: ButtonVariant;
  size: ButtonSize;
  disabled: boolean;
  label: string;
}> = {
  parameters: { layout: 'padded' },
  args: {
    variant: 'default',
    size: 'default',
    disabled: false,
    label: 'Start Workout',
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'solid', 'secondary', 'outline', 'ghost', 'destructive', 'link'],
    },
    size: {
      control: 'inline-radio',
      options: ['sm', 'default', 'lg', 'icon'],
    },
    disabled: { control: 'boolean' },
    label: { control: 'text' },
  },
  render: ({ variant, size, disabled, label }) => (
    <div className="space-y-6 max-w-2xl">
      <div className="rounded-xl border border-border bg-card p-6 flex items-center gap-4">
        <Button
          variant={variant}
          size={size}
          disabled={disabled}
          aria-label={size === 'icon' ? label : undefined}
        >
          {size === 'icon' ? '+' : label}
        </Button>
        <span className="text-xs font-mono text-muted-foreground">
          variant=&quot;{variant}&quot; size=&quot;{size}&quot; disabled={String(disabled)}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {(['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const).map((v) => (
          <div key={v} className="rounded-lg border border-border bg-card p-3 flex flex-col gap-2">
            <span className="text-xs font-mono text-muted-foreground">{v}</span>
            <div className="flex items-center gap-2">
              <Button variant={v} size="sm">Small</Button>
              <Button variant={v} size="default">Default</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Start Workout' })).toBeEnabled();
  },
};

export const BadgePropertyMatrix: StoryObj<{
  variant: BadgeVariant;
  label: string;
}> = {
  parameters: { layout: 'padded' },
  args: {
    variant: 'default',
    label: 'Benchmark',
  },
  argTypes: {
    variant: {
      control: 'inline-radio',
      options: ['default', 'secondary', 'outline', 'destructive'],
    },
    label: { control: 'text' },
  },
  render: ({ variant, label }) => (
    <div className="rounded-xl border border-border bg-card p-6 flex flex-wrap items-center gap-3 max-w-xl">
      <Badge variant={variant}>{label}</Badge>
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="destructive">Destructive</Badge>
    </div>
  ),
};

export const FieldAndInputStates: StoryObj<{
  label: string;
  placeholder: string;
  description: string;
  errorText: string;
  disabled: boolean;
}> = {
  parameters: { layout: 'padded' },
  args: {
    label: 'Notebook Name',
    placeholder: 'e.g. Olympic Lifting Block',
    description: 'Appears in the L2 sidebar and feed metadata.',
    errorText: '',
    disabled: false,
  },
  argTypes: {
    label: { control: 'text' },
    placeholder: { control: 'text' },
    description: { control: 'text' },
    errorText: { control: 'text', description: 'Non-empty string renders FieldError state' },
    disabled: { control: 'boolean' },
  },
  render: ({ label, placeholder, description, errorText, disabled }) => (
    <div className="rounded-xl border border-border bg-card p-6 max-w-md space-y-4">
      <Field name="notebookName" invalid={Boolean(errorText)} disabled={disabled}>
        <FieldLabel>{label}</FieldLabel>
        <Input placeholder={placeholder} disabled={disabled} />
        {description && <FieldDescription>{description}</FieldDescription>}
        {errorText && <FieldError>{errorText}</FieldError>}
      </Field>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Notebook Name' });
    await userEvent.type(input, 'Summer Cycle');
    await expect(input).toHaveValue('Summer Cycle');
  },
};
