 

#pragma once
#include <iostream>
#include <string.h>
#include "ParserBase.h"
#include "KeyStack.h"
#include <stack>

class PHPSerializedDataParser : public ParserBase {
public:
    PHPSerializedDataParser(IParserStreamReceiver &outReceiver, size_t parser_depth);
    size_t push(const char* buf, size_t len);
    void finish();
    virtual const std::string &name() const;
    bool error() const;
    virtual size_t depth() { return m_keyStack.depth(); }
private:
    bool onCheckLength ();
    size_t handleValue (const char &c);
    bool handleStateAfterFinish (const std::string &type);
    void onStateValue (); // this function must never be called when the m_stack is empty
    void onStateKey ();
    void onEmptyStack (std::string type);
    bool onDataEnd (char termChar, bool checkEndBlock);
    bool m_error = false;

    enum type_state
    {
        s_start_class,
        s_class_onValue,
        s_object_string_calc,
        s_start_object,
        s_start_array,
        s_null,
        s_start_string,
        s_string_calc,
        s_string_onValue,
        s_string_escape,
        s_string_escape_x_1,
        s_string_escape_x_2,
        s_integer_onValue,
        s_boolean_OnValue,
        s_ref_onValue
    };
    enum phase_state {
        s_start,
        s_data_end,
        s_class_data_end,
        s_colon,
        s_length,
        s_value,
        s_prim_colon
    };
    enum key_value_state {
        s_clear_kv,
        s_onKey,
        s_onValue
    };
    struct State {
        enum phase_state phase_state = s_start;
        enum type_state type_state;
        enum key_value_state kv_state = s_clear_kv;
        size_t length = 0;
        size_t current_length = 0;
        bool isObject = false;
        bool isClass = false;
    };
    State m_state;
    std::string m_value;
    std::string m_key;
    std::string m_length;
    IParserStreamReceiver &m_outReceiver;
    KeyStack m_keyStack;
    std::stack <State> m_stack;
    size_t m_parser_depth;
    static const std::string m_parserName;
};
