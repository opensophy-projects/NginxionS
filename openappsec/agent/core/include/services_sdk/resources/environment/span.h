 

#ifndef __SPAN_H__
#define __SPAN_H__

#include <string>
#include "context.h"

class Span
{
public:

    enum class ContextType
    {
        NEW,
        CHILD_OF,
        FOLLOWS_FROM
    };

    std::string
    convertSpanContextTypeToString(ContextType type);

    Span(std::string _trace_id, ContextType _type = ContextType::NEW, std::string _prev_span = std::string());
    ~Span();

    std::string getTraceId() const;
    std::string getSpanId() const;
    ContextType getSpanContextType() const;
    std::string getPrevSpanId() const;

private:
    std::string trace_id;
    std::string span_id;
    ContextType context_type;
    std::string prev_span_id;
    Context context;
};

class SpanWrapper
{
public:
    SpanWrapper(
        std::string _trace_id,
        Span::ContextType _type = Span::ContextType::NEW,
        std::string _prev_span = std::string()
    );
    std::string getTraceId() const;
    std::string getSpanId() const;
    Span::ContextType getSpanContextType() const;
    std::string getPrevSpanId() const;

private:
    std::shared_ptr<Span> span;
};
#endif // __SPAN_H__
