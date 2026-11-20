 

#ifndef __TOP_VALUES_H__
#define __TOP_VALUES_H__

#ifndef __GENERIC_METRIC_H__
#error metric/top_values.h should not be included directly
#endif // __GENERIC_METRIC_H__

#include <vector>
#include <algorithm>

namespace MetricCalculations
{

template <typename T, uint N>
class TopValues : public MetricCalc
{
public:
    template <typename ... Args>
    TopValues(GenericMetric *metric, const std::string &title, const Args & ... args)
            :
        MetricCalc(metric, title, args ...)
    {
        values.reserve(N);
    }

    void
    report(const T &new_value)
    {
        if (values.size() < N) {
            values.push_back(new_value);
            return;
        }

        std::sort(values.begin(), values.end());
        for (T &old_value : values) {
            if (old_value < new_value) {
                old_value = new_value;
                return;
            }
        }
    }

    void
    reset() override
    {
        values.clear();
    }

    float
    getValue() const override
    {
        return std::nanf("");
    }

    std::vector<T>
    getTopValues() const
    {
        auto res = values;
        std::sort(res.begin(), res.end());
        return res;
    }

    void
    save(cereal::JSONOutputArchive &ar) const override
    {
        ar(cereal::make_nvp(getMetricName(), getTopValues()));
    }

    LogField
    getLogField() const override
    {
        return LogField(getMetricName(), getTopValues());
    }

private:
    std::vector<T> values;
};

} // namespace MetricCalculations

#endif // __TOP_VALUES_H__
