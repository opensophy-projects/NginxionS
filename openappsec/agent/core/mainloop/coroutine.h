 

#ifndef __COROUTINE_H__
#define __COROUTINE_H__

#include <boost/coroutine2/all.hpp>

#include "i_mainloop.h"
#include "maybe_res.h"

class RoutineWrapper
{
    using pull_type = boost::coroutines2::coroutine<void>::pull_type;
    using push_type = boost::coroutines2::coroutine<void>::push_type;

public:
    RoutineWrapper(
        I_MainLoop::RoutineType _pri,
        I_MainLoop::Routine func,
        bool is_primary,
        const std::string &_routine_name
    );

    ~RoutineWrapper();
    RoutineWrapper(const RoutineWrapper &) = delete;
    RoutineWrapper(RoutineWrapper &&) = default;
    RoutineWrapper & operator=(const RoutineWrapper &) = delete;
    RoutineWrapper & operator=(RoutineWrapper &&) = default;

    bool isPrimary() { return is_primary; }
    const std::string & getRoutineName() const { return routine_name; }
    bool isActive() const;
    bool shouldRun(const I_MainLoop::RoutineType &limit) const;
    void run();
    void yield();
    void halt();
    void resume();

private:
    static void invoke(pull_type &pull, I_MainLoop::Routine func);
    static RoutineWrapper *active; // Used by `invoke` to set the value of `pull`

    I_MainLoop::RoutineType pri;
    // `pull` will hold the object that returns the flow control back to the mainloop.
    pull_type pull;
    push_type routine;
    bool is_primary;
    bool is_halt = false;
    std::string routine_name;
};

#endif // __COROUTINE_H__
