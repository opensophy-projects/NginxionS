 

#ifndef __COUNTER_H__
#define __COUNTER_H__

#ifndef __GENERIC_METRIC_H__
#error metric/counter.h should not be included directly
#endif // __GENERIC_METRIC_H_

namespace MetricCalculations
{

class Counter : public MetricCalc
{
public:
    template <typename ... Args>
    Counter(GenericMetric *metric, const std::string &title, const Args & ... args)
            :
        MetricCalc(metric, title, args ...),
        counter(0)
    {
    }

    void
    reset() override
    {
        counter = 0;
    }

    uint64_t
    getCounter() const
    {
        return counter;
    }

    float
    getValue() const override
    {
        return static_cast<float>(counter);
    }

    void
    save(cereal::JSONOutputArchive &ar) const override
    {
        ar(cereal::make_nvp(getMetricName(), getCounter()));
    }

    void
    report(const uint64_t &new_value)
    {
        counter += new_value;
    }

    LogField
    getLogField() const override
    {
        return LogField(getMetricName(), static_cast<uint64_t>(getCounter()));
    }

private:
    uint64_t counter;
};

} // namespace MetricCalculations

#endif // __COUNTER_H__
