 

#ifndef __I_CPU_H__
#define __I_CPU_H__

#include "enum_array.h"

class I_CPU
{
public:
    enum CPUGeneralDataEntryType {
        USER,
        NICE,
        SYS,
        IDLE,
        IOWAIT,
        IRQ,
        SOFTIRQ,
        STEAL,
        GUEST,
        GUEST_NICE,

        COUNT
    };

    virtual double getCurrentProcessCPUUsage() = 0;
    virtual Maybe<double> getCurrentGeneralCPUUsage() = 0;
};

#endif // __I_CPU_H__
