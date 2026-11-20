 

#ifndef __GENERIC_RULEBASE_CONTEXT_H__
#define __GENERIC_RULEBASE_CONTEXT_H__

#include "rulebase_config.h"
#include "context.h"
#include "config.h"

enum class RuleRegistrationState {REGISTERED, UNREGISTERED, UNINITIALIZED};

class GenericRulebaseContext
{
public:
    GenericRulebaseContext() : ctx(), registration_state(RuleRegistrationState::UNINITIALIZED) {}

    void activate(const BasicRuleConfig &rule);

    void activate();

    void deactivate() { if (registration_state == RuleRegistrationState::REGISTERED) ctx.deactivate(); }

private:
    Context ctx;
    RuleRegistrationState registration_state;
};

#endif //__GENERIC_RULEBASE_CONTEXT_H__
