 

#ifndef __I_TRAP_HANDLER_H__
#define __I_TRAP_HANDLER_H__

#include <signal.h>

#include "maybe_res.h"
#include "common_is/trap_common.h"

class I_TrapHandler
{
public:
    using SignalHandler = std::function<Maybe<bool>(AgentTrapCmd)>;
    virtual Maybe<bool> registerTrap(AgentTrapCmd cmd, SignalHandler signal_handler) = 0;
    virtual void signalFunctionHandler(siginfo_t *info) = 0;

protected:
    virtual ~I_TrapHandler() {}
};

#endif // __I_TRAP_HANDLER_H__
