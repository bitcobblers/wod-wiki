# Query sandbox

```query
:segment{discipline:strength} | :sum{metric:totalVolume} by {week} last 6w | :timeseries{}
```
