 

#ifndef __FAILOPEN_MODE_STATUS_H__
#define __FAILOPEN_MODE_STATUS_H__

#include "event.h"

class FailopenModeEvent : public Event<FailopenModeEvent>
{
public:
    FailopenModeEvent(bool _failopen_status = false)
            :
        failopen_mode_status(_failopen_status)
    {
    }

    void
    setFailopenMode(bool status)
    {
        failopen_mode_status = status;
    }

    bool
    getFailopenMode() const
    {
        return failopen_mode_status;
    }

private:
    bool failopen_mode_status;
};

#endif // __FAILOPEN_MODE_STATUS_H__
