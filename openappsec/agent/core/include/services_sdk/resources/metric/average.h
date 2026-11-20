 

#ifndef __AVERAGE_H__
#define __AVERAGE_H__

#ifndef __GENERIC_METRIC_H__
#error metric/average.h should not be included directly
#endif // __GENERIC_METRIC_H__

namespace MetricCalculations
{

template <typename T>
class Average : public MetricCalc
{
public:
    template <typename ... Args>
    Average(GenericMetric *metric, const std::string &title, const Args & ... args)
            :
        MetricCalc(metric, title, args ...),
        sum(0),
        count(0)
    {
    }

    void
    report(const T &new_value)
    {
        sum += new_value;
        count++;
    }

    void
    reset() override
    {
        sum = 0;
        count = 0;
    }

    double
    getAverage() const
    {
        return (count > 0) ? double(sum)/count : 0;
    }

    float
    getValue() const override
    {
        return static_cast<float>(getAverage());
    }

    void
    save(cereal::JSONOutputArchive &ar) const override
    {
        ar(cereal::make_nvp(getMetricName(), getAverage()));
    }

    LogField
    getLogField() const override
    {
        return LogField(getMetricName(), static_cast<uint64_t>(getAverage()));
    }

private:
    T sum;
    uint count;
};

} // namespace MetricCalculations
#endif // __AVERAGE_H__
