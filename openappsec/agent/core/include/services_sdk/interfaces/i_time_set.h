 

#ifndef __I_TIME_SET_H__
#define __I_TIME_SET_H__

#include <chrono>

class I_TimeSet
{
public:
    virtual void setMonotonicTime(std::chrono::microseconds new_time) = 0;
    virtual void setWalltime(std::chrono::microseconds new_time) = 0;

protected:
    virtual ~I_TimeSet() {}
};

#endif // __I_TIME_SET_H__
