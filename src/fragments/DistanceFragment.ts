import { ICodeFragment, FragmentType } from "../CodeFragment";
import { CodeMetadata } from "../CodeMetadata";


export class DistanceFragment implements ICodeFragment {
  readonly value: { amount: string, units: string };
  readonly image: string;

  constructor(value: string, public units: string, public meta?: CodeMetadata) {
    this.value = { amount: value, units: units };
    this.image = `${value} ${units}`;
  }
  readonly type: string = "distance";
  readonly fragmentType = FragmentType.Distance;
}
