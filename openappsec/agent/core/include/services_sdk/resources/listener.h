 

#ifndef __LISTENER_H__
#define __LISTENER_H__

#include "event_is/listener_impl.h"

template <typename EventType>
class Listener : public ListenerImpl<EventType, typename EventType::EventReturnType>
{
};

#endif // __LISTENER_H__
