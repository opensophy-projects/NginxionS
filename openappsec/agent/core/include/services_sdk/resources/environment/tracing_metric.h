 

#ifndef __TRACING_METRIC_H__
#define __TRACING_METRIC_H__

#include "generic_metric.h"

class TraceEvent : public Event<TraceEvent>
{
public:
    void
    setTraceAmount(uint64_t value)
    {
        traces = value;
    }

    uint64_t
    getTraceAmount() const
    {
        return traces;
    }

private:
    uint64_t traces = 0;
};

class TraceFinishEvent : public Event<TraceFinishEvent>
{
public:
    void
    setSpanAmount(uint64_t value)
    {
        spans_per_trace = value;
    }

    uint64_t
    getSpanAmount() const
    {
        return spans_per_trace;
    }

private:
    uint64_t spans_per_trace = 0;
};

class TracingMetric
        :
    public GenericMetric,
    public Listener<TraceEvent>,
    public Listener<TraceFinishEvent>
{
public:
    void
    upon(const TraceEvent &event) override
    {
        current_traces_number.report(event.getTraceAmount());
    }

    void
    upon(const TraceFinishEvent &event) override
    {
        max_span_number.report(event.getSpanAmount());
        avg_spans_per_trace.report(event.getSpanAmount());
    }

private:
    MetricCalculations::LastReportedValue<uint64_t> current_traces_number{this, "currentTraceNumber"};
    MetricCalculations::Max<uint64_t> max_span_number{this, "maxSpanPerTrace", 0};
    MetricCalculations::Average<double> avg_spans_per_trace{this, "avgSpanPerTrace"};
};

#endif // __TRACING_METRIC_H__
