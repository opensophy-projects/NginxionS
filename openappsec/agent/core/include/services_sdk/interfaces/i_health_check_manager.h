 

#ifndef __I_HEALTH_CHECK_MANAGER__
#define __I_HEALTH_CHECK_MANAGER__

#include <fstream>

#include "health_check_status/health_check_status.h"

class I_Health_Check_Manager
{
public:
    virtual HealthCheckStatus getAggregatedStatus() = 0;
    virtual void printRepliesHealthStatus(std::ofstream &output_file) = 0;

protected:
    ~I_Health_Check_Manager() {}
};

#endif //__I_HEALTH_CHECK_MANAGER__
