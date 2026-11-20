 

#ifndef __TRACE_H__
#define __TRACE_H__

#include <string>

#include "context.h"

class Trace
{
public:
    Trace(std::string _id = std::string());
    ~Trace();

    std::string getTraceId() const;

private:
    std::string trace_id;
    Context context;
};

class TraceWrapper
{
public:
    TraceWrapper(std::string _id);
    std::string getTraceId() const;

private:
    std::shared_ptr<Trace> trace;
};
#endif // __TRACE_H__
