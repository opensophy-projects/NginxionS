 

#ifndef __MAINLOOP_METRIC_H__
#define __MAINLOOP_METRIC_H__

#include "generic_metric.h"

class MainloopEvent : public Event<MainloopEvent>
{
public:
    void
    setTimeSlice(int value)
    {
        time_slice_used = value;
    }

    void
    setSleepTime(uint64_t value)
    {
        sleep_time_used = value;
    }

    void
    setStressValue(uint32_t value)
    {
        current_stress_used = value;
    }

    uint32_t
    getTimeSlice() const
    {
        return time_slice_used;
    }

    uint32_t
    getSleepTime() const
    {
        return sleep_time_used;
    }

    uint32_t
    getStressValue() const
    {
        return current_stress_used;
    }

private:
    uint32_t time_slice_used = 0;
    uint64_t sleep_time_used = 0;
    uint32_t current_stress_used = 0;
};

class MainloopMetric
        :
    public GenericMetric,
    public Listener<MainloopEvent>
{
public:
    void
    upon(const MainloopEvent &event) override
    {
        max_time_slice.report(event.getTimeSlice());
        avg_time_slice.report(event.getTimeSlice());
        last_report_time_slice.report(event.getTimeSlice());
        max_sleep_time.report(event.getSleepTime());
        avg_sleep_time.report(event.getSleepTime());
        last_report_sleep_time.report(event.getSleepTime());
        max_stress_value.report(event.getStressValue());
        avg_stress_value.report(event.getStressValue());
        last_report_stress_value.report(event.getStressValue());
    }

private:
    MetricCalculations::Max<uint32_t> max_time_slice{this, "mainloopMaxTimeSliceSample", 0};
    MetricCalculations::Average<double> avg_time_slice{this, "mainloopAvgTimeSliceSample"};
    MetricCalculations::LastReportedValue<uint32_t> last_report_time_slice{this, "mainloopLastTimeSliceSample"};
    MetricCalculations::Max<uint64_t> max_sleep_time{this, "mainloopMaxSleepTimeSample", 0};
    MetricCalculations::Average<double> avg_sleep_time{this, "mainloopAvgSleepTimeSample"};
    MetricCalculations::LastReportedValue<uint32_t> last_report_sleep_time{this, "mainloopLastSleepTimeSample"};
    MetricCalculations::Max<uint32_t> max_stress_value{this, "mainloopMaxStressValueSample", 0};
    MetricCalculations::Average<double> avg_stress_value{this, "mainloopAvgStressValueSample"};
    MetricCalculations::LastReportedValue<uint32_t> last_report_stress_value{this, "mainloopLastStressValueSample"};
};

#endif // __MAINLOOP_METRIC_H__
