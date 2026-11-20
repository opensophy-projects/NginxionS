/*! \file deque.hpp
    \brief Support for types found in \<deque\>
    \ingroup STLSupport */

#ifndef CEREAL_TYPES_DEQUE_HPP_
#define CEREAL_TYPES_DEQUE_HPP_

#include <cereal/cereal.hpp>
#include <deque>

namespace cereal
{
  //! Saving for std::deque
  template <class Archive, class T, class A> inline
  void CEREAL_SAVE_FUNCTION_NAME( Archive & ar, std::deque<T, A> const & deque )
  {
    ar( make_size_tag( static_cast<size_type>(deque.size()) ) );

    for( auto const & i : deque )
      ar( i );
  }

  //! Loading for std::deque
  template <class Archive, class T, class A> inline
  void CEREAL_LOAD_FUNCTION_NAME( Archive & ar, std::deque<T, A> & deque )
  {
    size_type size;
    ar( make_size_tag( size ) );

    deque.resize( static_cast<size_t>( size ) );

    for( auto & i : deque )
      ar( i );
  }
} // namespace cereal

#endif // CEREAL_TYPES_DEQUE_HPP_
