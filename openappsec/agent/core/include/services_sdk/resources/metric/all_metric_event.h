 

#ifndef __ALL_METRIC_EVENT_H__
#define __ALL_METRIC_EVENT_H__

#include "event.h"

class AllMetricEvent : public Event<AllMetricEvent, std::string>
{
public:
    AllMetricEvent(bool _with_reset = false) : with_reset(_with_reset) {}

    void
    setReset(bool value)
    {
        with_reset = value;
    }

    bool
    getReset() const
    {
        return with_reset;
    }

private:
    bool with_reset;
};

#endif // __ALL_METRIC_EVENT_H__
