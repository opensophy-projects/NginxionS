 

#include "rest.h"

using namespace std;

ostream &
RestHelper::printIndent(ostream &os, uint indent)
{
    for (uint i = 0; i < indent; i++) os << "    ";
    return os;
}

void
RestHelper::reportError(std::string const &err)
{
    throw JsonError(err);
}

Maybe<string>
ServerRest::performRestCall(istream &in, const map<string, string> &headers)
{
    if (wantsHeaders()) {
        request_headers = headers;
    }
    try {
        try {
            int firstChar = in.peek();
            if (firstChar != EOF) {
                // array as root is not supported in JSONInputArchive format
                // but this struct is in bulk invalidations requirements
                // we will change the format here
                if (firstChar == '[') {
                    std::string content((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
                    std::string modifiedContent = "{\"" + BULK_ARRAY_NAME + "\": " + content + "}";
                    std::istringstream* modifiedStream = new std::istringstream(modifiedContent);
                    in.rdbuf(modifiedStream->rdbuf());
                }
            }
            cereal::JSONInputArchive in_ar(in);
            load(in_ar);
        } catch (cereal::Exception &e) {
            throw JsonError(string("JSON parsing failed: ") + e.what());
        }
        doCall();
        stringstream out;
        {
            cereal::JSONOutputArchive out_ar(out);
            save(out_ar);
        }
        return out.str();
    } catch (const JsonError &e) {
        return genError(e.getMsg());
    }
}

void
BasicRest::performOutputingSchema(ostream &out, int level)
{
    RestHelper::printIndent(out, level) << "{\n";

    RestHelper::printIndent(out, level + 1) << "\"properties\": {";
    outputSchema(out, level + 2);
    out << "\n";
    RestHelper::printIndent(out, level + 1) << "},\n";

    RestHelper::printIndent(out, level + 1) << "\"required\": [";
    outputRequired(out, level + 2);
    out << "\n";
    RestHelper::printIndent(out, level+1) << "]\n";

    RestHelper::printIndent(out, level) << "}";
}

void
BasicRest::outputSchema(ostream &os, int level)
{
    bool first = true;
    for (auto it : schema_func) {
        if (!first) os << ',';
        os << '\n';
        it(os, level);
        first = false;
    }
}

void
BasicRest::outputRequired(ostream &os, int level)
{
    bool first = true;
    for (auto it : required) {
        if (!first) os << ',';
        os << '\n';
        RestHelper::printIndent(os, level) << "\"" << it << '"';
        first = false;
    }
}

Maybe<string>
ClientRest::genJson() const
{
    try {
        stringstream out;
        {
            cereal::JSONOutputArchive out_ar(out);
            save(out_ar);
        }
        return out.str();
    } catch (const JsonError &e) {
        return genError(e.getMsg());
    }
}

bool
ClientRest::loadJson(const string &json)
{
    try
    {
        stringstream in;
        in.str(json);
        try {
            cereal::JSONInputArchive in_ar(in);
            load(in_ar);
        } catch (cereal::Exception &e) {
            throw JsonError(string("JSON parsing failed: ") + e.what());
        }
        return true;
    }
    catch (const JsonError &j)
    {
        return false;
    }
}
