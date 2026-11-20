 

#ifndef __LAST_REPORTED_VALUE_H__
#define __LAST_REPORTED_VALUE_H__

#ifndef __GENERIC_METRIC_H__
#error metric/last_reported_value.h should not be included directly
#endif // __GENERIC_METRIC_H_

namespace MetricCalculations
{

template <typename T>
class LastReportedValue : public MetricCalc
{
public:
    template <typename ... Args>
    LastReportedValue(GenericMetric *metric, const std::string &title, const Args & ... args)
            :
        MetricCalc(metric, title, args ...)
    {
    }

    void
    reset() override
    {
        last_reported = T();
    }

    T
    getLastReportedValue() const
    {
        return last_reported;
    }

    float
    getValue() const override
    {
        return static_cast<float>(last_reported);
    }

    void
    save(cereal::JSONOutputArchive &ar) const override
    {
        ar(cereal::make_nvp(getMetricName(), getLastReportedValue()));
    }

    void
    report(const T &new_value)
    {
        last_reported = new_value;
    }

    LogField
    getLogField() const override
    {
        return LogField(getMetricName(), static_cast<uint64_t>(getLastReportedValue()));
    }

private:
    T last_reported{};
};

} // namespace MetricCalculations

#endif // __LAST_REPORTED_VALUE_H__
