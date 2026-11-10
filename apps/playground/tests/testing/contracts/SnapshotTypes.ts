/**
 * Shared snapshot/diff types for test infrastructure.
 *
 * Extracted from TestableRuntime so that consumers (SnapshotDiffViewer)
 * don't need to import the full 814-line harness.
 */

/**
 * Snapshot of runtime state at a point in time.
 */
export interface RuntimeSnapshot {
    /** Timestamp when snapshot was taken */
    timestamp: number;

    /** Stack state */
    stack: {
        depth: number;
        blockKeys: string[];
        currentBlockKey?: string;
    };

    /** Memory state */
    memory: {
        entries: Array<{
            id: string;
            ownerId: string;
            type: string;
            visibility: 'public' | 'private' | 'inherited';
            value: unknown;
        }>;
        totalCount: number;
    };

    /** Label for this snapshot */
    label?: string;
}

/**
 * Diff between two snapshots.
 */
export interface SnapshotDiff {
    before: RuntimeSnapshot;
    after: RuntimeSnapshot;

    stack: {
        pushed: string[];
        popped: string[];
        depthChange: number;
    };

    memory: {
        allocated: string[];
        released: string[];
        modified: Array<{ id: string; oldValue: unknown; newValue: unknown }>;
    };
}
