# Screen: Session Execution Detail

- **Route:** `/results/:sessionId`
- **Host:** `QueriableStreamView` with `createResultDetailProfile(sessionId)`
- **Pinned source:** `SessionSource` renders the saved workout revision above the results
- **Domain models:** `Session`, `EventRecord`, `Note`, `BlockRevision`, `BlockIndexRow`

## Query and results

The default WQL is `:session{result:<sessionId>, plane:segment}`. The view defaults to the `PropertyTable` rows layout, with one row per recorded segment. The same WQL composer and URL `?q=` state used by other stream routes owns filtering, so changing a filter updates both the visible query and the executed results.

The saved-workout section remains independent of the segment filter. It resolves the session's pinned note block revision and provides saved-analytics replay and block history.

## Dashboard composition

**Add to dashboard** opens `QueryToDashboardDialog` with the current WQL as both the dataset and the initial widget query. Further query/filter changes therefore carry into dashboard composition without reconstruction. The author can adjust the calculation and visualization, then create a dashboard or append the widget to an editable one.

## Mobile

The results remain in the rows layout. The compact WQL composer stays in the mobile query dock, and dashboard composition is available through the stream actions menu.
