 

#ifndef __I_SIGNAL_HANDLER_H__
#define __I_SIGNAL_HANDLER_H__

class I_SignalHandler
{
public:
    virtual void dumpErrorReport(const std::string &error) = 0;
    virtual Maybe<std::vector<std::string>> getBacktrace() = 0;

protected:
    ~I_SignalHandler() {}
};

#endif // __I_SIGNAL_HANDLER_H__
