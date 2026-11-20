 

#ifndef __MIN_H__
#define __MIN_H__

#ifndef __GENERIC_METRIC_H__
#error metric/min.h should not be included directly
#endif // __GENERIC_METRIC_H_

namespace MetricCalculations
{

template <typename T>
class Min : public MetricCalc
{
public:
    Min(GenericMetric *metric, const std::string &title) : Min(metric, title, 0) {}

    template<typename ... Args>
    Min(GenericMetric *metric, const std::string &title, T max_val, const Args & ... args)
            :
        MetricCalc(metric, title, args ...),
        min(max_val),
        reset_value(max_val)
    {
    }

    void
    report(const T &new_value)
    {
        if (new_value < min || first) min = new_value;
        first = false;
    }

    void
    reset() override
    {
        min = reset_value;
        first = true;
    }

    T
    getMin() const
    {
        return min;
    }

    float
    getValue() const override
    {
        return static_cast<float>(min);
    }

    void
    save(cereal::JSONOutputArchive &ar) const override
    {
        ar(cereal::make_nvp(getMetricName(), min));
    }

    LogField
    getLogField() const override
    {
        return LogField(getMetricName(), static_cast<uint64_t>(getMin()));
    }

private:
    T min;
    T reset_value;
    bool first = true;
};

} // namespace MetricCalculations

#endif // __MIN_H__
