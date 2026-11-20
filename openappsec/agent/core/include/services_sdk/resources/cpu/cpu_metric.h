 

#ifndef __CPU_METRIC_H__
#define __CPU_METRIC_H__

#include "generic_metric.h"

class CPUEvent : public Event<CPUEvent>
{
public:
    CPUEvent() = default;

    CPUEvent(double value, bool _is_external)
            :
        cpu_usage(value),
        is_external(_is_external)
    {}

    double getCPU() const { return cpu_usage; }

    bool isExternal() const { return is_external; }

    void setCPU(double value) { cpu_usage = value; }

private:
    double cpu_usage = 0;
    bool is_external = false;
};

class CPUMetric
        :
    public GenericMetric,
    public Listener<CPUEvent>
{
public:
    CPUMetric(bool _is_external = false) : is_external(_is_external) {}

    void
    upon(const CPUEvent &event) override
    {
        if (event.isExternal() != is_external) return;
        max.report(event.getCPU());
        last_report.report(event.getCPU());
        avg.report(event.getCPU());
    }

private:
    MetricCalculations::Max<double> max{this, "cpuMaxSample", 0};
    MetricCalculations::Average<double> avg{this, "cpuAvgSample"};
    MetricCalculations::LastReportedValue<double> last_report{this, "cpuSample"};
    bool is_external = false;
};

#endif //__CPU_METRIC_H__
