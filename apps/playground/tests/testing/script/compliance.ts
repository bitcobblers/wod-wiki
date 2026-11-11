import { createComplianceRunner, type ComplianceContext as CanonicalComplianceContext } from '@wod-wiki/lang-harness/script/compliance';
import { TestScript } from './TestScript';

export type ComplianceContext = CanonicalComplianceContext<TestScript>;

export const describeCompliance = createComplianceRunner((scriptText, config) =>
    TestScript.compile(scriptText, config),
);
