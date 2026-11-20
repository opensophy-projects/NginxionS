 

#ifndef __HYBRID_MODE_TELEMETRY_H__
#define __HYBRID_MODE_TELEMETRY_H__

#include "generic_metric.h"

class HybridModeMetricEvent : public Event<HybridModeMetricEvent>
{
public:
    HybridModeMetricEvent() {}
};

class HybridModeMetric : public GenericMetric, public Listener<HybridModeMetricEvent>
{
public:
    void upon(const HybridModeMetricEvent &event) override;

private:
    MetricCalculations::LastReportedValue<int> wd_process_restart{this, "watchdogProcessStartupEventsSum"};
};

#endif // __HYBRID_MODE_TELEMETRY_H__
