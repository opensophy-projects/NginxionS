 

#include "listener.h"

void
BaseListener::registerListener()
{
    if (is_registered) return;
    for (auto &function : activate) {
        (*function)(this);
    }
    is_registered = true;
}

void
BaseListener::unregisterListener()
{
    if (!is_registered) return;
    for (auto &function : deactivate) {
        (*function)(this);
    }
    is_registered = false;
}

void
BaseListener::setActivation(ActivationFunction act, ActivationFunction deact)
{
    activate.insert(act);
    deactivate.insert(deact);
}
