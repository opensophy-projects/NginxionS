 

#ifndef __EVENT_H__
#define __EVENT_H__

#include "event_is/event_impl.h"

template <typename EventType, typename ReplyType = void>
class Event : public EventImpl<EventType, ReplyType>
{
};

#endif // __EVENT_H__
