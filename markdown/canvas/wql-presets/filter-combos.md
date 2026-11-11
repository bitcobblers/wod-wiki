# Query sandbox

```query
:segment{!discipline:recovery, intensity:high} | :sum{metric:totalVolume} by {week} last 8w | :timeseries{}
```
