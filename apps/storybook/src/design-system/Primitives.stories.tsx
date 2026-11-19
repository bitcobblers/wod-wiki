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
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
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
  WodOverlayHost,
  notifyToast,
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
      <WodOverlayHost />
    </div>
  );
}

const meta: Meta<typeof PrimitivesShowcase> = {
  title: 'Design System/UI-SDK Primitives',
  component: PrimitivesShowcase,
  parameters: {
    layout: 'fullscreen',
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
