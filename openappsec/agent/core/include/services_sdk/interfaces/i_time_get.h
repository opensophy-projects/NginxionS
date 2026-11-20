 

#ifndef __I_TIME_GET_H__
#define __I_TIME_GET_H__

#include <string>
#include <chrono>

class I_TimeGet
{
public:
    virtual std::chrono::microseconds getMonotonicTime() = 0;
    virtual std::chrono::microseconds getWalltime() = 0;
    virtual std::string getWalltimeStr() = 0;
    virtual std::string getWalltimeStr(const std::chrono::microseconds &ms) = 0;
    virtual std::string getLocalTimeStr() = 0;

protected:
    virtual ~I_TimeGet() {}
};

#endif // __I_TIME_GET_H__
