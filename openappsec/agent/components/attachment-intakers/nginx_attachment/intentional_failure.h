 

#ifndef __INTENTIONAL_FAILURE__
#define __INTENTIONAL_FAILURE__

#include <chrono>

class IntentionalFailureHandler
{
public:
    enum class FailureType {
        None,
        CreateSocket,
        AcceptSocket,
        InitializeConnectionChannel,
        WriteDataToSocket,
        ReceiveDataFromSocket,
        ParsingResponse,
        GetDataFromAttchment,
        RegisterAttchment,
        GetInstanceID,
        COUNT
    };

    void init();
    bool shouldFail(bool was_originaly_successful, FailureType failure, bool *failed_on_purpose);
    void delayIfNeeded(FailureType failure);
    
    void preload();

private:
    void RegisterIntentionalFailure();

    FailureType failure_type;
    bool is_failure_enabled;
    bool is_limited;
    int fail_count;
    int allow_count;

    FailureType delay_failure_type;
    bool is_delay_enabled;
    std::chrono::microseconds delay_amount;
};

#endif // __INTENTIONAL_FAILURE__
