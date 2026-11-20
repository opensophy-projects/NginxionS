 

#ifndef __EVENT_H__
#error "event_impl.h sould only be included from event.h"
#endif // __EVENT_H__

#include "listener.h"

template <typename EventType, typename ReturnType>
class EventImpl
{
public:
    using EventReturnType = ReturnType;
    using MyListener = Listener<EventType>;

    void notify() const { MyListener::notify(dynamic_cast<const EventType *>(this)); }

    std::vector<ReturnType> query() const { return MyListener::query(dynamic_cast<const EventType *>(this)); }

    std::vector<std::pair<std::string, ReturnType>>
    performNamedQuery() const
    {
        return MyListener::performNamedQuery(dynamic_cast<const EventType *>(this));
    }

protected:
    virtual ~EventImpl() {} // Makes Event polimorphic, so dynamic_cast will work
};

template <typename EventType>
class EventImpl<EventType, void>
{
public:
    using EventReturnType = void;

    void notify() const { Listener<EventType>::notify(dynamic_cast<const EventType *>(this)); }

protected:
    virtual ~EventImpl() {} // Makes Event polimorphic, so dynamic_cast will work
};
